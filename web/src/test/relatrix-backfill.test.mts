import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyPlan, buildPlan, describePlan, parseArgs, type FactsSource } from '../lib/relatrix/backfill.ts'
import { payloadHash } from '../lib/relatrix/sync.ts'
import { orgLifecyclePayload } from '../lib/relatrix/lifecycle.ts'
import { memoryStore } from './support/memory-store.mts'

const T = { a: '2026-09-01T10:00:00.000Z', b: '2026-09-05T10:00:00.000Z', c: '2026-09-10T10:00:00.000Z', d: '2026-09-15T10:00:00.000Z' }

function source(over: Partial<FactsSource> = {}): FactsSource {
  return {
    orgs: async () => [
      { id: 'org_c', name: 'Cedar Gas', createdAt: T.c },
      { id: 'org_a', name: 'Alder Energy', createdAt: T.a },
      { id: 'org_b', name: 'Birch Oil', createdAt: T.b },
    ],
    sites: async () => [{ org_id: 'org_a', at: '2026-09-03T10:00:00.000Z' }, { org_id: 'org_a', at: '2026-09-02T10:00:00.000Z' }, { org_id: 'org_b', at: T.d }],
    packages: async () => [{ org_id: 'org_a', at: '2026-09-20T10:00:00.000Z' }],
    companyInvites: async () => [{ org_id: 'org_a', at: '2026-09-04T10:00:00.000Z' }],
    queued: async () => new Map(),
    ...over,
  }
}

test('the plan is oldest organization first, each in the furthest stage it has reached', async () => {
  const plan = await buildPlan(source())
  assert.deepEqual(plan.items.map((i) => [i.orgId, i.state, i.stage]), [['org_a', 'new', 'Adopting'], ['org_b', 'new', 'Onboarding'], ['org_c', 'new', 'Signed up']])
})

test('each milestone date is the earliest, not the latest, and a worker invite is not a contractor', async () => {
  const plan = await buildPlan(source())
  assert.deepEqual(plan.items[0]!.payload.milestones, {
    signed_up: T.a, onboarding: '2026-09-02T10:00:00.000Z', live: '2026-09-20T10:00:00.000Z', adopting: '2026-09-04T10:00:00.000Z',
  })
  // companyInvites() is the company-type invitations only; an organization with none has no Adopting.
  assert.equal(plan.items[1]!.payload.milestones.adopting, undefined)
})

test('the payload is exactly what the live path queues for the same facts, so a later event sees nothing changed', async () => {
  const plan = await buildPlan(source())
  const live = orgLifecyclePayload({ id: 'org_b', name: 'Birch Oil', createdAt: T.b }, { firstSite: T.d, firstPackage: null, firstContractorInvite: null })
  assert.equal(payloadHash(plan.items[1]!.payload), payloadHash(live))
})

test('what is already queued as it stands is not queued again; what moved on since is', async () => {
  const first = await buildPlan(source())
  const known = new Map([['org_a', payloadHash(first.items[0]!.payload)], ['org_b', 'an old hash']])
  const plan = await buildPlan(source({ queued: async () => known }))
  assert.deepEqual(plan.items.map((i) => [i.orgId, i.state]), [['org_a', 'unchanged'], ['org_b', 'changed'], ['org_c', 'new']])
})

test('only and skip pick organizations, and a skip is reported, not silent', async () => {
  // What the command line passes when nothing was asked for: no filter, not "none".
  assert.equal((await buildPlan(source(), { only: [], skip: [] })).items.length, 3)
  assert.deepEqual((await buildPlan(source(), { only: ['org_b'] })).items.map((i) => i.orgId), ['org_b'])
  const plan = await buildPlan(source(), { skip: ['org_c', 'org_b'] })
  assert.deepEqual(plan.items.map((i) => i.orgId), ['org_a'])
  assert.deepEqual(plan.skipped.map((s) => s.orgId), ['org_b', 'org_c'])
})

test('an organization with no name, or a date that is not a date, is skipped with its reason and the rest carry on', async () => {
  const plan = await buildPlan(source({
    orgs: async () => [{ id: 'org_x', name: '  ', createdAt: T.a }, { id: 'org_y', name: 'Yew', createdAt: 'not a date' }, { id: 'org_z', name: 'Zinc', createdAt: T.b }],
  }))
  assert.deepEqual(plan.items.map((i) => i.orgId), ['org_z'])
  assert.deepEqual(plan.skipped.map((s) => [s.orgId, s.reason]), [['org_x', 'it has no name'], ['org_y', 'its created date is not a date']])
})

test('a row with a bad date or no organization is ignored, not trusted', async () => {
  const plan = await buildPlan(source({ sites: async () => [{ org_id: 'org_a', at: 'garbage' }, { org_id: '', at: T.b }] }))
  assert.equal(plan.items[0]!.payload.milestones.onboarding, undefined)
})

test('applying queues new and changed in order, up to the limit, and leaves the rest for the next run', async () => {
  const store = memoryStore()
  const plan = await buildPlan(source())
  assert.deepEqual(await applyPlan(plan, store, 2), { queued: 2, unchanged: 0 })
  assert.deepEqual([...store.rows.values()].map((r) => r.entity_id).sort(), ['org_a', 'org_b'])

  // Run again with what is queued now: only org_c remains.
  const queued = new Map([...store.rows.values()].map((r) => [r.entity_id, r.payload_hash]))
  const next = await buildPlan(source({ queued: async () => queued }))
  assert.deepEqual(await applyPlan(next, store), { queued: 1, unchanged: 2 })
  assert.equal(store.rows.size, 3)
})

test('running it twice, or at the same moment as the live hooks, never queues a state twice', async () => {
  const store = memoryStore()
  const plan = await buildPlan(source())
  await applyPlan(plan, store)
  assert.deepEqual(await applyPlan(plan, store), { queued: 0, unchanged: 3 }, 'the store refuses the same state again even with a stale plan')
  assert.equal(store.rows.size, 3)
})

test('the plan writes nothing and says what it would do', async () => {
  const lines = describePlan(await buildPlan(source(), { skip: ['org_c'] }))
  assert.equal(lines[0], '2 organizations: 2 new, 0 changed, 0 already queued as they stand.')
  assert.match(lines[1]!, /Adopting 1, Onboarding 1/)
  assert.ok(lines.includes('  + Alder Energy (org_a) → Adopting'))
  assert.ok(lines.includes('  - skipped org_c: skipped by request'))
})

test('the command line: plan by default, and a mistake is an error, not a guess', () => {
  assert.deepEqual(parseArgs([]), { command: 'plan', limit: Infinity, only: [], skip: [], yes: false })
  assert.deepEqual(parseArgs(['--queue', '--limit', '5', '--only', 'a,b', '--skip', 'c', '--yes']), { command: 'queue', limit: 5, only: ['a', 'b'], skip: ['c'], yes: true })
  assert.deepEqual(parseArgs(['--status']), { command: 'status', limit: Infinity, only: [], skip: [], yes: false })
  for (const bad of [['--queu'], ['--limit'], ['--limit', '0'], ['--limit', 'x'], ['--limit', '1.5'], ['--only'], ['--only', '--queue'], ['org_1']]) {
    assert.ok('error' in parseArgs(bad), JSON.stringify(bad))
  }
})
