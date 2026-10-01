import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRelatrixClient } from '../lib/relatrix/client.ts'
import { handlers, parseCompanyUpsert } from '../lib/relatrix/ops.ts'
import { BLOCKED_RECHECK_SECONDS, MAX_ATTEMPTS, backoffSeconds, drain, idempotencyKey, payloadHash, type Handler } from '../lib/relatrix/sync.ts'
import { startFakeRelatrix, type FakeRelatrix } from './support/fake-relatrix.mts'
import { memoryStore, type MemoryStore } from './support/memory-store.mts'

let fake: FakeRelatrix
let store: MemoryStore
before(async () => {
  fake = await startFakeRelatrix()
})
after(async () => {
  await fake.close()
})
beforeEach(() => {
  fake.reset()
  store = memoryStore()
})

const client = () => createRelatrixClient({ baseUrl: fake.url, apiKey: fake.key, timeoutMs: 2000 })
const live = (limit?: number) => drain({ store, handlers, mode: 'live', client: client(), ...(limit ? { limit } : {}) })
const company = (over: Record<string, unknown> = {}) => ({ contrak_id: 'co_1', name: 'Apex Scaffolding', ...over })
const queue = (payload: unknown = company(), id = 'co_1') => store.enqueue('contractor_company', id, 'company.upsert', payload)
const row = (id = 'co_1') => store.byEntity('contractor_company', id)!

// ── the engine's pure parts ────────────────────────────────────────────────

test('the same wanted state hashes the same however its keys are ordered, and a changed one does not', () => {
  assert.equal(payloadHash({ a: 1, b: [1, 2], c: { x: 1, y: 2 } }), payloadHash({ c: { y: 2, x: 1 }, b: [1, 2], a: 1 }))
  assert.notEqual(payloadHash({ a: 1 }), payloadHash({ a: 2 }))
  assert.equal(payloadHash({ a: 1, b: undefined }), payloadHash({ a: 1 }))
})

test('an idempotency key is stable for one wanted state, differs for another, and fits', () => {
  const h = payloadHash(company())
  assert.equal(idempotencyKey('contractor_company', 'co_1', 'company.upsert', h), idempotencyKey('contractor_company', 'co_1', 'company.upsert', h))
  assert.notEqual(idempotencyKey('contractor_company', 'co_1', 'company.upsert', h), idempotencyKey('contractor_company', 'co_1', 'company.upsert', payloadHash(company({ name: 'Other' }))))
  assert.ok(idempotencyKey('client_company_link', 'x'.repeat(100), 'company.upsert', h).length <= 255)
})

test('waits grow, then stop growing', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(backoffSeconds), [30, 120, 600, 1800, 3600, 3600, 3600])
})

// ── delivery ───────────────────────────────────────────────────────────────

test('a queued company is delivered once: created in Relatrix with its flag, ConTrak’s id on it', async () => {
  assert.equal(await queue(company({ domain: 'apex.example', tags: ['Scaffolding'] })), 'queued')
  assert.deepEqual(await live(), { delivered: 1, retried: 0, blocked: 0, abandoned: 0, dryRun: 0 })
  const made = [...fake.companies.values()]
  assert.equal(made.length, 1)
  assert.deepEqual({ name: made[0]!.name, domain: made[0]!.domain, source: made[0]!.source, tags: made[0]!.tags, refs: made[0]!.external_refs }, {
    name: 'Apex Scaffolding', domain: 'apex.example', source: 'contrak', tags: ['contrak', 'scaffolding'], refs: { contrak: 'co_1' },
  })
  assert.equal(row().status, 'delivered')
  assert.equal(row().remote_id, made[0]!.id)
})

test('delivered is final: nothing is sent again', async () => {
  await queue()
  await live()
  const sent = fake.requests.length
  assert.deepEqual(await live(), { delivered: 0, retried: 0, blocked: 0, abandoned: 0, dryRun: 0 })
  assert.equal(fake.requests.length, sent)
})

test('queueing the same wanted state again, in any key order, changes nothing; a changed state is queued again', async () => {
  await queue(company({ domain: 'apex.example' }))
  await live()
  assert.equal(await queue({ domain: 'apex.example', name: 'Apex Scaffolding', contrak_id: 'co_1' }), 'unchanged')
  assert.equal(row().status, 'delivered')
  assert.equal(await queue(company({ name: 'Apex Scaffolding Ltd' })), 'queued')
  assert.equal(row().status, 'pending')
  await live()
  assert.equal([...fake.companies.values()][0]!.name, 'Apex Scaffolding Ltd')
  assert.equal(fake.companies.size, 1)
})

test('a replay after a lost answer makes no second company: the company already there is found, not created again', async () => {
  await queue()
  fake.setFail([])
  await live()
  // Simulate "it landed but the answer was lost": the row goes back to pending although Relatrix has the company.
  row().status = 'pending'
  row().attempts = 0
  await live()
  assert.equal(fake.companies.size, 1)
  assert.equal(row().status, 'delivered')
})

test('a company already in Relatrix is updated, never duplicated, and what a person set is left alone', async () => {
  await queue()
  await live()
  const there = [...fake.companies.values()][0]!
  there.tags = ['contrak', 'vip']
  there.source = 'referral'
  await queue(company({ name: 'Apex Scaffolding Ltd', tags: ['scaffolding'] }))
  await live()
  assert.equal(fake.companies.size, 1)
  assert.equal(there.name, 'Apex Scaffolding Ltd')
  assert.deepEqual(there.tags, ['contrak', 'scaffolding', 'vip'])
  assert.equal(there.source, 'referral')
})

test('nothing changed in Relatrix means nothing is written', async () => {
  await queue(company({ tags: ['x'] }))
  await live()
  const writes = () => fake.requests.filter((r) => r.method !== 'GET').length
  const before = writes()
  // A change ConTrak keeps but Relatrix does not take on an update (the domain) runs the handler, which finds nothing to change.
  await queue(company({ tags: ['x'], domain: 'apex.example' }))
  await live()
  assert.equal(row().status, 'delivered')
  assert.equal(writes(), before)
})

// ── failure ────────────────────────────────────────────────────────────────

test('a server fault is retried later, with the wait growing, and then delivered', async () => {
  await queue()
  fake.setFail([503])
  assert.deepEqual(await live(), { delivered: 0, retried: 1, blocked: 0, abandoned: 0, dryRun: 0 })
  assert.equal(row().status, 'pending')
  assert.equal(row().attempts, 1)
  assert.equal(row().next_attempt_at, store.clock.now + 30)
  assert.equal(row().last_status, 503)

  assert.equal((await live()).retried + (await live()).delivered, 0, 'not due yet: nothing happens')
  store.clock.now += 31
  assert.equal((await live()).delivered, 1)
  assert.equal(row().status, 'delivered')
  assert.equal(fake.companies.size, 1)
})

test('a dropped connection and a hung request are retried; a rate limit waits at least as long as it asked', async () => {
  await queue()
  fake.setFail([0])
  await live()
  assert.equal(row().status, 'pending')
  await queue(company({ contrak_id: 'co_9', name: 'Other' }), 'co_9')
  fake.setFail([429])
  await live()
  // First attempt of its own: the usual wait would be 30 seconds, but Relatrix asked for 120.
  assert.equal(row('co_9').next_attempt_at, store.clock.now + 120)
})

test('a refusal Relatrix will repeat is abandoned loudly, with its reason, and not resent', async () => {
  fake.companies.set('x', { id: 'x', name: 'Apex Scaffolding', domain: null, source: null, tags: [], external_refs: {} })
  await queue()
  assert.deepEqual(await live(), { delivered: 0, retried: 0, blocked: 0, abandoned: 1, dryRun: 0 })
  assert.equal(row().status, 'abandoned')
  assert.match(row().last_error!, /conflicts with a record that already exists/)
  assert.equal(row().last_status, 409)
  const sent = fake.requests.length
  store.clock.now += 100_000
  await live()
  assert.equal(fake.requests.length, sent, 'an abandoned sync is not sent again')
  assert.equal(await queue(), 'unchanged', 'and queueing the same thing does not bring it back')
})

test('a wrong key or missing scope blocks the sync for a person to fix, checks again later, and does not use up attempts', async () => {
  await queue()
  fake.setFail([401])
  assert.deepEqual(await live(), { delivered: 0, retried: 0, blocked: 1, abandoned: 0, dryRun: 0 })
  assert.equal(row().status, 'blocked')
  assert.equal(row().attempts, 0)
  assert.equal(row().next_attempt_at, store.clock.now + BLOCKED_RECHECK_SECONDS)
  assert.match(row().last_error!, /Check the key and its scopes/)
  fake.setFail([403])
  store.clock.now += BLOCKED_RECHECK_SECONDS + 1
  await live()
  assert.equal(row().attempts, 0)
  store.clock.now += BLOCKED_RECHECK_SECONDS + 1
  assert.equal((await live()).delivered, 1, 'once the key is fixed it goes through')
})

test('after enough transient failures it gives up, saying so', async () => {
  await queue()
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    fake.setFail([500])
    store.clock.now += 4000
    await live()
  }
  assert.equal(row().status, 'abandoned')
  assert.match(row().last_error!, new RegExp(`Gave up after ${MAX_ATTEMPTS} attempts`))
})

test('a payload the handler cannot use is abandoned at once; an unknown op too', async () => {
  await queue({ contrak_id: 'co_1' })
  await live()
  assert.equal(row().status, 'abandoned')
  assert.match(row().last_error!, /name is required/)
  assert.equal(fake.requests.length, 0)
  await store.enqueue('contractor_company', 'co_2', 'company.vanish', {})
  await live()
  assert.match(row('co_2').last_error!, /no handler for “company.vanish”/)
})

test('a handler that blows up unexpectedly is retried with a plain message that leaks nothing', async () => {
  const bad: Record<string, Handler> = { 'company.upsert': { describe: () => '', run: async () => { throw new Error(`boom with ${fake.key}`) } } }
  await queue()
  await drain({ store, handlers: bad, mode: 'live', client: client() })
  assert.equal(row().status, 'pending')
  assert.equal(row().last_error, 'Something unexpected went wrong.')
  assert.equal(JSON.stringify(row()).includes(fake.key), false)
})

// ── a Relatrix outage never becomes a problem for the caller ───────────────

test('queueing never talks to Relatrix, so a Relatrix outage cannot touch the ConTrak action that queued it', async () => {
  fake.setFail([503, 503, 503])
  assert.equal(await queue(), 'queued')
  assert.equal(fake.requests.length, 0)
})

// ── dry run and being off ──────────────────────────────────────────────────

test('a dry run works out what it would send, records it, and sends nothing', async () => {
  await queue()
  assert.deepEqual(await drain({ store, handlers, mode: 'dry-run', client: null }), { delivered: 0, retried: 0, blocked: 0, abandoned: 0, dryRun: 1 })
  assert.equal(row().status, 'dry_run')
  assert.match(row().last_error!, /Would create or update the Relatrix company “Apex Scaffolding” \(ConTrak id co_1\), source contrak, tag contrak/)
  assert.equal(fake.requests.length, 0)
  assert.deepEqual(await drain({ store, handlers, mode: 'dry-run', client: null }), { delivered: 0, retried: 0, blocked: 0, abandoned: 0, dryRun: 0 }, 'not taken again while still a dry run')
})

test('going live delivers what a dry run held back', async () => {
  await queue()
  await drain({ store, handlers, mode: 'dry-run', client: null })
  assert.equal((await live()).delivered, 1)
  assert.equal(row().status, 'delivered')
})

test('a dry run does not need a key at all, and a live run with no client is blocked, not failed', async () => {
  await queue()
  assert.equal((await drain({ store, handlers, mode: 'live', client: null })).blocked, 1)
  assert.equal(row().attempts, 0)
  assert.match(row().last_error!, /not configured/)
})

// ── concurrency ────────────────────────────────────────────────────────────

test('two drains at once take each row once between them', async () => {
  for (let i = 1; i <= 6; i++) await queue(company({ contrak_id: `co_${i}`, name: `Company ${i}` }), `co_${i}`)
  const [a, b] = await Promise.all([live(3), live(3)])
  assert.equal(a.delivered + b.delivered, 6)
  assert.equal(fake.companies.size, 6)
})

test('a drain that died holding a row loses it after its lease, and the retry is safe because the company is found, not duplicated', async () => {
  await queue()
  const taken = await store.claim(5, false)
  assert.equal(taken.length, 1)
  assert.equal((await live()).delivered, 0, 'still leased: nobody else takes it')
  store.clock.now += 301
  assert.equal((await live()).delivered, 1)
  assert.equal(fake.companies.size, 1)
})

test('a state that changes while it is being sent goes round again instead of being marked delivered', async () => {
  await queue()
  const [taken] = await store.claim(1, false)
  await queue(company({ name: 'Apex Scaffolding Ltd' }))
  // The old attempt finishes: it must not mark the new state delivered.
  await store.finish(taken!, { kind: 'delivered', remoteId: 'old' })
  assert.equal(row().status, 'pending')
  assert.equal(row().payload_hash, payloadHash(company({ name: 'Apex Scaffolding Ltd' })))
})

// ── payloads ───────────────────────────────────────────────────────────────

test('a company payload is checked before anything is sent', () => {
  assert.deepEqual(parseCompanyUpsert({ contrak_id: ' co_1 ', name: ' Apex ', tags: [' A '] }), { contrak_id: 'co_1', name: 'Apex', tags: ['A'] })
  for (const bad of [null, [], 'x', {}, { contrak_id: 'c' }, { contrak_id: 'c', name: '' }, { contrak_id: 'c', name: 'x'.repeat(201) }, { contrak_id: 'c', name: 'n', domain: 5 },
    { contrak_id: 'c', name: 'n', tags: 'a' }, { contrak_id: 'c', name: 'n', tags: ['x'.repeat(41)] }, { contrak_id: 'c', name: 'n', tags: Array.from({ length: 20 }, (_, i) => `t${i}`) }]) {
    assert.throws(() => parseCompanyUpsert(bad), { name: 'InvalidPayload' }, JSON.stringify(bad))
  }
})

test('nothing about a person is in what a company sync sends', async () => {
  await queue(company({ contact_email: 'pat@apex.example', contact_name: 'Pat', workers: ['Sam'] }))
  await live()
  const sent = JSON.stringify(fake.requests.map((r) => r.body))
  for (const leak of ['pat@apex.example', 'Pat', 'Sam', 'contact', 'workers']) assert.equal(sent.includes(leak), false, leak)
})
