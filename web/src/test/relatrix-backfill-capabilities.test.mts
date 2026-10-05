import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCapabilityPlan, buildCapabilityPlan, describeCapabilityPlan, type CapabilitiesSource, type CompanyCapabilityRow } from '../lib/relatrix/backfill-capabilities.ts'
import { parseArgs } from '../lib/relatrix/backfill.ts'
import { capabilitiesPayload } from '../lib/relatrix/capability-sync.ts'
import { createRelatrixClient } from '../lib/relatrix/client.ts'
import { handlers } from '../lib/relatrix/ops.ts'
import { drain, payloadHash } from '../lib/relatrix/sync.ts'
import { startFakeRelatrix, type FakeRelatrix } from './support/fake-relatrix.mts'
import { memoryStore } from './support/memory-store.mts'

const co = (id: string, createdAt: string, held: CompanyCapabilityRow['held'], over: Partial<CompanyCapabilityRow> = {}): CompanyCapabilityRow => ({
  companyId: id, legalName: `Company ${id}`, contactEmail: `office@${id}.example.ca`, held, createdAt, ...over,
})
function source(over: Partial<CapabilitiesSource> = {}): CapabilitiesSource {
  return {
    companies: async () => [
      co('cc', '2026-09-12T10:00:00Z', [{ code: null, label: 'Stonework' }]),
      co('ca', '2026-09-10T10:00:00Z', [{ code: 'electrical', label: 'Electrical' }, { code: null, label: 'Heritage wiring' }]),
      co('cb', '2026-09-11T10:00:00Z', []),
    ],
    queued: async () => new Map(),
    ...over,
  }
}

test('the plan is oldest company first, a company with nothing to propose is left out, and the payload is the live one', async () => {
  const plan = await buildCapabilityPlan(source())
  assert.deepEqual(plan.items.map((i) => [i.companyId, i.state]), [['ca', 'new'], ['cc', 'new']])
  assert.equal(payloadHash(plan.items[0]!.payload), payloadHash(capabilitiesPayload(co('ca', '2026-09-10T10:00:00Z', [{ code: 'electrical', label: 'Electrical' }, { code: null, label: 'Heritage wiring' }]))))
  assert.equal(plan.items[0]!.payload.domain, 'ca.example.ca')
})

test('unchanged and changed are told apart, only and skip pick companies, and an unusable company is skipped with its reason', async () => {
  const first = await buildCapabilityPlan(source())
  const known = new Map([['ca', payloadHash(first.items[0]!.payload)], ['cc', 'old']])
  assert.deepEqual((await buildCapabilityPlan(source({ queued: async () => known }))).items.map((i) => [i.companyId, i.state]), [['ca', 'unchanged'], ['cc', 'changed']])
  assert.deepEqual((await buildCapabilityPlan(source(), { only: ['cc'] })).items.map((i) => i.companyId), ['cc'])
  assert.equal((await buildCapabilityPlan(source(), { only: [], skip: [] })).items.length, 2)
  assert.deepEqual((await buildCapabilityPlan(source(), { skip: ['ca'] })).skipped, [{ companyId: 'ca', reason: 'skipped by request' }])
  const bad = await buildCapabilityPlan(source({ companies: async () => [co('cx', '2026-09-01T10:00:00Z', [{ code: null, label: 'x' }], { legalName: ' ' }), co('cy', '2026-09-02T10:00:00Z', [{ code: null, label: 'y' }])] }))
  assert.deepEqual([bad.items.map((i) => i.companyId), bad.skipped.map((s) => s.companyId)], [['cy'], ['cx']])
})

test('applying queues up to the limit, leaves the rest, and never queues twice', async () => {
  const store = memoryStore()
  const plan = await buildCapabilityPlan(source())
  assert.deepEqual(await applyCapabilityPlan(plan, store, 1), { queued: 1, unchanged: 0 })
  assert.ok(store.byEntity('contractor_company', 'ca') && !store.byEntity('contractor_company', 'cc'))
  assert.deepEqual(await applyCapabilityPlan(plan, store), { queued: 1, unchanged: 1 })
  assert.deepEqual(await applyCapabilityPlan(plan, store), { queued: 0, unchanged: 2 })
})

test('the report names each company and what it would propose, and says a person reviews them', async () => {
  const lines = describeCapabilityPlan(await buildCapabilityPlan(source()))
  assert.equal(lines[0], '2 companies with capabilities: 2 new, 0 changed, 0 already queued as they stand.')
  assert.ok(lines.some((l) => l.includes('for a person to accept or reject in Review')))
  assert.ok(lines.includes('  + Company ca → Electrical, Heritage wiring [ca]'))
})

test('--capabilities is an option, and not together with --links', () => {
  assert.deepEqual(parseArgs(['--capabilities', '--queue']), { command: 'queue', links: false, capabilities: true, limit: Infinity, only: [], skip: [], yes: false })
  assert.ok('error' in (parseArgs(['--links', '--capabilities']) as object))
})

let fake: FakeRelatrix
before(async () => {
  fake = await startFakeRelatrix()
})
after(async () => {
  await fake.close()
})
beforeEach(() => fake.reset())

test('a backfilled company reaches Relatrix as proposals for review, and a second backfill sends nothing', async () => {
  const store = memoryStore()
  await applyCapabilityPlan(await buildCapabilityPlan(source()), store)
  const client = createRelatrixClient({ baseUrl: fake.url, apiKey: fake.key, timeoutMs: 2000 })
  assert.equal((await drain({ store, handlers, mode: 'live', client })).delivered, 2)
  assert.deepEqual(fake.capabilities.map((c) => c.status), ['proposed', 'proposed', 'proposed'])
  assert.equal(fake.companies.size, 2)
  const known = new Map(['ca', 'cc'].map((id) => [id, store.byEntity('contractor_company', id)!.payload_hash] as const))
  assert.deepEqual(await applyCapabilityPlan(await buildCapabilityPlan(source({ queued: async () => known })), store), { queued: 0, unchanged: 2 })
})
