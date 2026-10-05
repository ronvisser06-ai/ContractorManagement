import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { capabilitiesPayload } from '../lib/relatrix/capability-sync.ts'
import { createRelatrixClient } from '../lib/relatrix/client.ts'
import { CAPABILITY_VOCABULARY, handlers, parseCapabilities } from '../lib/relatrix/ops.ts'
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
  store = memoryStore()
})

const client = () => createRelatrixClient({ baseUrl: fake.url, apiKey: fake.key, timeoutMs: 2000 })
const live = () => drain({ store, handlers, mode: 'live', client: client() })
const payload = (caps: { code?: string; label: string }[] = [{ code: 'electrical', label: 'Electrical' }, { label: 'Heritage wiring' }], over: Record<string, unknown> = {}) => ({
  contrak_company_id: 'cco_1',
  name: 'Apex Electric Ltd',
  domain: 'apex-electric.ca',
  capabilities: caps,
  ...over,
})
const queue = (p: unknown = payload()) => store.enqueue('contractor_company', 'cco_1', 'company.capabilities', p)
const row = () => store.byEntity('contractor_company', 'cco_1')!
const company = () => [...fake.companies.values()].find((c) => c.name === 'Apex Electric Ltd')!
const termId = (code: string) => fake.terms.find((t) => t.code === code)!.id

// ── what crosses ────────────────────────────────────────────────────────────

test('the payload is the company’s name, the domain of its work address, and its capabilities in a fixed order, once each', () => {
  const p = capabilitiesPayload({
    companyId: 'cco_1',
    legalName: ' Apex Electric Ltd ',
    contactEmail: 'Pat@Apex-Electric.ca',
    held: [{ code: null, label: 'Stonework' }, { code: 'welding', label: 'Welding' }, { code: 'electrical', label: 'Electrical' }, { code: null, label: 'stonework' }, { code: 'welding', label: 'Welding' }, { code: null, label: ' ' }],
  })
  assert.deepEqual(p, {
    contrak_company_id: 'cco_1',
    name: 'Apex Electric Ltd',
    domain: 'apex-electric.ca',
    capabilities: [{ code: 'electrical', label: 'Electrical' }, { code: 'welding', label: 'Welding' }, { label: 'Stonework' }],
  })
  assert.ok(!JSON.stringify(p).includes('pat@') && !JSON.stringify(p).includes('Pat@'))
  assert.equal('domain' in capabilitiesPayload({ companyId: 'c', legalName: 'C', contactEmail: 'x@gmail.com', held: [] }), false)
})

test('the payload is checked, and a bad one is not retried', () => {
  assert.deepEqual(parseCapabilities(payload()), payload())
  for (const bad of [null, [], payload([], { contrak_company_id: ' ' }), payload([], { name: '' }), payload([], { capabilities: 'x' }), payload([{ label: '' }]), payload([{ code: 'Bad Code', label: 'X' }]), payload(Array.from({ length: 61 }, (_, i) => ({ label: `T${i}` })))]) {
    assert.throws(() => parseCapabilities(bad), { name: 'InvalidPayload' })
  }
})

// ── proposing ───────────────────────────────────────────────────────────────

test('a company’s capabilities become proposals: catalog entries as terms of ConTrak’s own vocabulary, the rest as free text', async () => {
  await queue()
  assert.deepEqual(await live(), { delivered: 1, retried: 0, blocked: 0, abandoned: 0, dryRun: 0 })
  assert.deepEqual(fake.vocabularies.map((v) => [v.key, v.name, v.shared]), [[CAPABILITY_VOCABULARY.key, CAPABILITY_VOCABULARY.name, false]])
  assert.deepEqual(fake.terms.map((t) => [t.code, t.label]), [['electrical', 'Electrical']])
  assert.deepEqual(fake.capabilities.map((c) => [c.company_id, c.status, c.term_id, c.free_text, c.quote]), [
    [company().id, 'proposed', termId('electrical'), null, 'Chosen by the company in ConTrak.'],
    [company().id, 'proposed', null, 'Heritage wiring', 'Chosen by the company in ConTrak.'],
  ])
  assert.equal(row().remote_id, company().id)
  assert.deepEqual([company().source, company().tags], ['contrak', ['contractor', 'contrak']])
})

test('only what is new is proposed when a company adds a capability, and nothing twice', async () => {
  await queue()
  await live()
  await queue(payload([{ code: 'electrical', label: 'Electrical' }, { code: 'welding', label: 'Welding and fabrication' }, { label: 'Heritage wiring' }]))
  await live()
  assert.equal(fake.capabilities.length, 3)
  assert.deepEqual(fake.terms.map((t) => t.code).sort(), ['electrical', 'welding'], 'a term is made once, when first needed')
  assert.equal(fake.vocabularies.length, 1)
  assert.equal(fake.capabilities.filter((c) => c.term_id === termId('welding')).length, 1)
})

test('what a person accepted or left waiting is not sent again, and what a person turned down stays turned down', async () => {
  await queue()
  await live()
  const [el, text] = fake.capabilities
  el!.status = 'accepted'
  text!.status = 'rejected'
  await queue(payload([{ code: 'electrical', label: 'Electrical' }, { label: 'Heritage wiring' }, { label: 'Stonework' }]))
  await live()
  assert.deepEqual(fake.capabilities.map((c) => [c.free_text ?? 'term', c.status]), [['term', 'accepted'], ['Heritage wiring', 'rejected'], ['Stonework', 'proposed']])
})

test('a turned-down term, or free text turned down in other letters, is not proposed again either', async () => {
  await queue()
  await live()
  const [el, text] = fake.capabilities
  el!.status = 'rejected'
  text!.status = 'rejected'
  text!.free_text = 'HERITAGE wiring'
  await queue(payload([{ code: 'electrical', label: 'Electrical' }, { label: 'Heritage wiring' }, { label: 'Stonework' }]))
  await live()
  assert.deepEqual(fake.capabilities.map((c) => [c.term_id ? 'term' : c.free_text, c.status]), [['term', 'rejected'], ['HERITAGE wiring', 'rejected'], ['Stonework', 'proposed']])
})

test('a term Ron retired is skipped without failing the rest, and an existing vocabulary and its terms are reused', async () => {
  fake.vocabularies.push({ id: 'v-1', key: CAPABILITY_VOCABULARY.key, name: 'Ron’s name for it', shared: false })
  fake.terms.push({ id: 't-el', vocabulary_id: 'v-1', code: 'electrical', label: 'Electrical', retired_at: '2026-01-01T00:00:00Z' })
  fake.terms.push({ id: 't-wd', vocabulary_id: 'v-1', code: 'welding', label: 'Welding', retired_at: null })
  await queue(payload([{ code: 'electrical', label: 'Electrical' }, { code: 'welding', label: 'Welding' }]))
  assert.equal((await live()).delivered, 1)
  assert.equal(fake.vocabularies.length, 1)
  assert.equal(fake.terms.length, 2)
  assert.deepEqual(fake.capabilities.map((c) => c.term_id), ['t-wd'])
})

test('free text alone needs no vocabulary, and a company with nothing yet is only found or made', async () => {
  await queue(payload([{ label: 'Heritage wiring' }]))
  await live()
  assert.equal(fake.vocabularies.length, 0)
  assert.equal(fake.capabilities.length, 1)
  fake.reset()
  store = memoryStore()
  await queue(payload([]))
  await live()
  assert.deepEqual([fake.companies.size, fake.vocabularies.length, fake.capabilities.length], [1, 0, 0])
})

test('a company Ron already has is matched and adopted, not duplicated, and the proposals go to it', async () => {
  fake.companies.set('rx-1', { id: 'rx-1', name: 'Apex Electrical Services', domain: 'apex-electric.ca', source: 'referral', tags: [], external_refs: {} })
  await queue()
  await live()
  assert.equal(fake.companies.size, 1)
  assert.deepEqual([fake.companies.get('rx-1')!.name, fake.companies.get('rx-1')!.source, fake.companies.get('rx-1')!.external_refs], ['Apex Electrical Services', 'referral', { contrak: 'cco_1' }])
  assert.ok(fake.capabilities.every((c) => c.company_id === 'rx-1'))
})

test('an unchanged payload is not sent again, and a replay after a dropped answer proposes each only once', async () => {
  await queue()
  await live()
  assert.equal(await queue(), 'unchanged')
  const queuedAgain = await store.claim(10, false)
  assert.equal(queuedAgain.length, 0)

  fake.reset()
  store = memoryStore()
  await queue()
  fake.setFail([-2, -2, -2, -2, -2, -2, 503])
  await live()
  fake.setFail([])
  store.clock.now += 3600
  await live()
  assert.deepEqual([fake.capabilities.length, fake.terms.length, fake.vocabularies.length, fake.companies.size], [2, 1, 1, 1])
  for (const r of fake.requests.filter((x) => x.method === 'POST')) assert.match(r.idempotencyKey ?? '', /^contrak-contractor_company-cco_1-company\.capabilities-/)
})

test('a key without the capabilities scope blocks the sync for a person to fix, and spends no attempt', async () => {
  await queue()
  fake.setFail([-2, -2, -2, -2, 403])
  assert.equal((await live()).blocked, 1)
  assert.equal(row().status, 'blocked')
  assert.equal(row().attempts, 0)
})

test('a dry run says what it would propose and sends nothing', async () => {
  await queue()
  assert.equal((await drain({ store, handlers, mode: 'dry-run', client: client() })).dryRun, 1)
  assert.equal(fake.requests.length, 0)
  assert.match(row().last_error ?? '', /Would propose 2 capabilities for “Apex Electric Ltd”[\s\S]*review/)
})
