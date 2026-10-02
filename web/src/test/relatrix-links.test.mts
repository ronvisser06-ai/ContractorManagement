import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRelatrixClient } from '../lib/relatrix/client.ts'
import { domainFromEmail, linkPayload } from '../lib/relatrix/links.ts'
import { handlers, parseLinkUses } from '../lib/relatrix/ops.ts'
import { drain } from '../lib/relatrix/sync.ts'
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
  fake.addUsesType()
  store = memoryStore()
})

const client = () => createRelatrixClient({ baseUrl: fake.url, apiKey: fake.key, timeoutMs: 2000 })
const live = () => drain({ store, handlers, mode: 'live', client: client() })
const link = (over: Record<string, unknown> = {}) => ({
  contrak_link_id: 'ccl_1',
  status: 'active',
  since: '2026-10-02',
  org: { id: 'org_1', name: 'Northwind Energy' },
  company: { id: 'cco_1', name: 'Apex Electric Ltd', domain: 'apex-electric.ca' },
  ...over,
})
const queue = (id = 'ccl_1', payload: unknown = link()) => store.enqueue('client_company_link', id, 'link.uses', payload)
const companies = () => [...fake.companies.values()]
const byName = (name: string) => companies().find((c) => c.name === name)!
const edges = () => [...fake.relationships.values()]
const rowOf = (id = 'ccl_1') => store.byEntity('client_company_link', id)!

// ── what crosses ────────────────────────────────────────────────────────────

test('only the domain of a work address crosses, never the address, and a mailbox provider gives none', () => {
  assert.equal(domainFromEmail('Pat@Apex-Electric.CA'), 'apex-electric.ca')
  for (const e of ['pat@gmail.com', 'pat@Outlook.com', 'pat@shaw.ca', 'nope', '', null, undefined, 'a@b', 'a@@b.ca', 'x@-bad.ca']) assert.equal(domainFromEmail(e), null, String(e))
  const p = linkPayload({ linkId: 'ccl_1', status: 'active', acceptedAt: '2026-10-02T15:00:00Z', org: { id: 'org_1', name: ' Northwind ' }, company: { id: 'cco_1', legalName: ' Apex ', contactEmail: 'pat@apex-electric.ca' } })
  assert.deepEqual(p, { contrak_link_id: 'ccl_1', status: 'active', since: '2026-10-02', org: { id: 'org_1', name: 'Northwind' }, company: { id: 'cco_1', name: 'Apex', domain: 'apex-electric.ca' } })
  assert.ok(!JSON.stringify(p).includes('pat@'), 'the address itself never leaves')
  assert.equal(linkPayload({ linkId: 'l', status: 'invited', acceptedAt: null, org: { id: 'o', name: 'N' }, company: { id: 'c', legalName: 'C', contactEmail: 'x@gmail.com' } }).company.domain, undefined)
  assert.equal('since' in linkPayload({ linkId: 'l', status: 'suspended', acceptedAt: '2026-10-02T15:00:00Z', org: { id: 'o', name: 'N' }, company: { id: 'c', legalName: 'C', contactEmail: null } }), false)
})

test('the payload is checked, and a bad one is not retried', () => {
  assert.deepEqual(parseLinkUses(link()), link())
  for (const bad of [null, [], link({ contrak_link_id: ' ' }), link({ status: 'gone' }), link({ org: { id: 'o' } }), link({ company: { id: 'c', name: 'n', domain: 5 } }), link({ since: 'yesterday' }), link({ company: 'x' })]) {
    assert.throws(() => parseLinkUses(bad), { name: 'InvalidPayload' })
  }
})

// ── match before create ─────────────────────────────────────────────────────

test('a new contractor is created flagged, with the organization and one edge between them', async () => {
  await queue()
  assert.deepEqual(await live(), { delivered: 1, retried: 0, blocked: 0, abandoned: 0, dryRun: 0 })
  const apex = byName('Apex Electric Ltd'), north = byName('Northwind Energy')
  assert.deepEqual([apex.source, apex.tags, apex.external_refs, apex.domain], ['contrak', ['contractor', 'contrak'], { contrak: 'cco_1' }, 'apex-electric.ca'])
  assert.deepEqual([north.source, north.tags, north.external_refs], ['contrak', ['client', 'contrak'], { contrak_org: 'org_1' }])
  assert.equal(edges().length, 1)
  assert.deepEqual([edges()[0]!.from_company_id, edges()[0]!.to_company_id, edges()[0]!.started_on, edges()[0]!.ended_on], [north.id, apex.id, '2026-10-02', null])
  assert.equal(rowOf().status, 'delivered')
  assert.equal(rowOf().remote_id, apex.id)
})

test('a company filed under the ConTrak id is the one used, and nothing is made twice', async () => {
  await queue()
  await live()
  const before = fake.requests.length
  await queue('ccl_1', link({ company: { id: 'cco_1', name: 'Apex Electric Ltd', domain: 'apex-electric.ca' } })) // unchanged: no-op
  assert.equal(await store.claim(10, false).then((r) => r.length), 0)
  assert.equal(fake.requests.length, before)
  // A changed link is re-sent: the same companies and the same edge come back, none new.
  await queue('ccl_1', link({ since: '2026-10-03' }))
  await live()
  assert.equal(companies().length, 2)
  assert.equal(edges().length, 1)
})

test('an existing company is matched by domain before name, and adopted without changing it', async () => {
  fake.companies.set('rx-1', { id: 'rx-1', name: 'Apex Electrical Services', domain: 'apex-electric.ca', source: 'referral', tags: ['vip'], external_refs: { planitize: 'p1' } })
  await queue()
  await live()
  assert.equal(companies().length, 2, 'Northwind and the matched Apex; no second Apex')
  const apex = fake.companies.get('rx-1')!
  assert.deepEqual([apex.name, apex.source], ['Apex Electrical Services', 'referral'])
  assert.deepEqual(apex.tags, ['contractor', 'contrak', 'vip'])
  assert.deepEqual(apex.external_refs, { planitize: 'p1', contrak: 'cco_1' })
  assert.equal(edges()[0]!.to_company_id, 'rx-1')
})

test('failing a domain, an existing company is matched by name, ignoring case', async () => {
  fake.companies.set('rx-2', { id: 'rx-2', name: 'APEX ELECTRIC LTD', domain: null, source: null, tags: [], external_refs: {} })
  await queue('ccl_1', link({ company: { id: 'cco_1', name: 'Apex Electric Ltd' } }))
  await live()
  assert.equal(companies().length, 2)
  assert.equal(fake.companies.get('rx-2')!.source, null, 'a source Ron left empty stays empty')
  assert.deepEqual(fake.companies.get('rx-2')!.external_refs, { contrak: 'cco_1' })
})

test('two organizations that bring in the same company end up with one company and an edge each', async () => {
  await queue('ccl_1')
  await queue('ccl_2', link({ contrak_link_id: 'ccl_2', org: { id: 'org_2', name: 'Birch Mining' } }))
  await live()
  assert.equal(companies().filter((c) => c.name === 'Apex Electric Ltd').length, 1)
  const apex = byName('Apex Electric Ltd')
  assert.deepEqual(edges().map((e) => e.to_company_id), [apex.id, apex.id])
  assert.equal(new Set(edges().map((e) => e.from_company_id)).size, 2)
})

test('two ConTrak records for one real company share the Relatrix company, and the first id stays filed', async () => {
  await queue('ccl_1')
  await queue('ccl_2', link({ contrak_link_id: 'ccl_2', org: { id: 'org_2', name: 'Birch Mining' }, company: { id: 'cco_2', name: 'Apex Electric Ltd', domain: 'apex-electric.ca' } }))
  await live()
  const apex = byName('Apex Electric Ltd')
  assert.equal(companies().filter((c) => c.name === 'Apex Electric Ltd').length, 1)
  assert.equal(apex.external_refs.contrak, 'cco_1')
  assert.equal(edges().length, 2)
})

test('more than one possible match blocks the sync and says so, rather than guessing', async () => {
  fake.companies.set('rx-a', { id: 'rx-a', name: 'Apex A', domain: 'apex-electric.ca', source: null, tags: [], external_refs: {} })
  fake.companies.set('rx-b', { id: 'rx-b', name: 'Apex B', domain: 'apex-electric.ca', source: null, tags: [], external_refs: {} })
  await queue()
  assert.equal((await live()).blocked, 1)
  assert.match(rowOf().last_error ?? '', /More than one Relatrix company has the domain apex-electric\.ca/)
  assert.equal(edges().length, 0)
})

// ── the edge ────────────────────────────────────────────────────────────────

test('without the "Uses contractor" type the sync is blocked with the instruction, and nothing is created', async () => {
  fake.types.length = 0
  await queue()
  assert.equal((await live()).blocked, 1)
  assert.match(rowOf().last_error ?? '', /Create it in Settings → Relationship types/)
  assert.equal(companies().length, 0)
})

test('a retired type, or one between the wrong kinds, is refused too', async () => {
  fake.types.length = 0
  fake.addUsesType({ retired_at: '2026-01-01T00:00:00Z' })
  await queue()
  assert.equal((await live()).blocked, 1)
  fake.types.length = 0
  fake.addUsesType({ to_kind: 'contact' })
  store = memoryStore()
  await queue()
  assert.equal((await live()).blocked, 1)
  assert.match(rowOf().last_error ?? '', /from a company to a company/)
})

test('an invited link knows the company but makes no edge; becoming active makes one', async () => {
  await queue('ccl_1', link({ status: 'invited', since: undefined }))
  await live()
  assert.equal(companies().length, 2)
  assert.equal(edges().length, 0)
  await queue('ccl_1', link())
  await live()
  assert.equal(edges().length, 1)
})

test('a suspended link ends the edge, and an active one brings it back; none is ever deleted or duplicated', async () => {
  await queue()
  await live()
  await queue('ccl_1', link({ status: 'suspended', since: undefined }))
  await live()
  assert.equal(edges().length, 1)
  assert.equal(edges()[0]!.ended_on, new Date().toISOString().slice(0, 10))
  await queue('ccl_1', link())
  await live()
  assert.equal(edges().length, 1)
  assert.equal(edges()[0]!.ended_on, null)
})

test('a person’s own edge between the same two companies is used, not duplicated', async () => {
  await queue()
  await live()
  const mine = edges()[0]!
  fake.relationships.delete(mine.id)
  store = memoryStore()
  fake.relationships.set('hand-made', { ...mine, id: 'hand-made', started_on: '2020-01-01' })
  await queue()
  await live()
  assert.deepEqual(edges().map((e) => e.id), ['hand-made'])
})

test('a dry run says what it would do and sends nothing', async () => {
  await queue()
  assert.equal((await drain({ store, handlers, mode: 'dry-run', client: client() })).dryRun, 1)
  assert.equal(fake.requests.length, 0)
  assert.match(rowOf().last_error ?? '', /Would make sure “Apex Electric Ltd”/)
})

test('a replay after an unanswered request does not duplicate: every write carries a key', async () => {
  await queue()
  fake.setFail([-2, -2, -2, -2, 503])
  await live()
  fake.setFail([])
  store.clock.now += 3600
  await live()
  assert.equal(companies().length, 2)
  assert.equal(edges().length, 1)
  for (const r of fake.requests.filter((x) => x.method === 'POST')) assert.match(r.idempotencyKey ?? '', /^contrak-client_company_link-ccl_1-/)
})
