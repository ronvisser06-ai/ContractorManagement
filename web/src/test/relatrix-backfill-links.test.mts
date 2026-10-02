import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { applyLinkPlan, buildLinkPlan, describeLinkPlan, type LinkRow, type LinksSource } from '../lib/relatrix/backfill-links.ts'
import { parseArgs } from '../lib/relatrix/backfill.ts'
import { createRelatrixClient } from '../lib/relatrix/client.ts'
import { linkPayload } from '../lib/relatrix/links.ts'
import { handlers } from '../lib/relatrix/ops.ts'
import { drain, payloadHash } from '../lib/relatrix/sync.ts'
import { startFakeRelatrix, type FakeRelatrix } from './support/fake-relatrix.mts'
import { memoryStore } from './support/memory-store.mts'

const row = (id: string, org: string, company: string, over: Partial<LinkRow> = {}): LinkRow => ({
  linkId: id,
  status: 'active',
  acceptedAt: '2026-09-20T10:00:00.000Z',
  invitedAt: '2026-09-10T10:00:00.000Z',
  org: { id: org, name: `Org ${org}` },
  company: { id: company, legalName: `Co ${company}`, contactEmail: `office@${company.replace('_', '')}.example.ca` },
  ...over,
})

function source(over: Partial<LinksSource> = {}): LinksSource {
  return {
    links: async () => [
      row('ccl_c', 'org_b', 'cco_2', { invitedAt: '2026-09-12T10:00:00.000Z', status: 'invited', acceptedAt: null }),
      row('ccl_a', 'org_a', 'cco_1', { invitedAt: '2026-09-10T10:00:00.000Z' }),
      row('ccl_b', 'org_a', 'cco_2', { invitedAt: '2026-09-11T10:00:00.000Z', company: { id: 'cco_2', legalName: 'Co cco_2', contactEmail: 'someone@gmail.com' } }),
    ],
    queued: async () => new Map(),
    ...over,
  }
}

test('the plan is oldest link first, and says each link’s status', async () => {
  const plan = await buildLinkPlan(source())
  assert.deepEqual(plan.items.map((i) => [i.linkId, i.state, i.payload.status]), [['ccl_a', 'new', 'active'], ['ccl_b', 'new', 'active'], ['ccl_c', 'new', 'invited']])
})

test('the payload is exactly what the live path queues for the same facts, and a mailbox address gives no domain', async () => {
  const [a, b] = (await buildLinkPlan(source())).items
  assert.equal(payloadHash(a!.payload), payloadHash(linkPayload(row('ccl_a', 'org_a', 'cco_1'))))
  assert.equal(a!.payload.company.domain, 'cco1.example.ca')
  assert.equal(b!.payload.company.domain, undefined)
  assert.ok(!JSON.stringify(a!.payload).includes('office@'))
})

test('unchanged and changed are told apart from what was last queued', async () => {
  const first = await buildLinkPlan(source())
  const known = new Map([['ccl_a', payloadHash(first.items[0]!.payload)], ['ccl_b', 'an old hash']])
  const plan = await buildLinkPlan(source({ queued: async () => known }))
  assert.deepEqual(plan.items.map((i) => [i.linkId, i.state]), [['ccl_a', 'unchanged'], ['ccl_b', 'changed'], ['ccl_c', 'new']])
})

test('only and skip name organizations or links, and a skip is reported', async () => {
  assert.deepEqual((await buildLinkPlan(source(), { only: ['org_a'] })).items.map((i) => i.linkId), ['ccl_a', 'ccl_b'])
  assert.deepEqual((await buildLinkPlan(source(), { only: ['ccl_c'] })).items.map((i) => i.linkId), ['ccl_c'])
  assert.equal((await buildLinkPlan(source(), { only: [], skip: [] })).items.length, 3)
  const plan = await buildLinkPlan(source(), { skip: ['org_a', 'ccl_c'] })
  assert.deepEqual(plan.items, [])
  assert.deepEqual(plan.skipped.map((s) => [s.linkId, s.reason]), [['ccl_a', 'skipped by request'], ['ccl_b', 'skipped by request'], ['ccl_c', 'skipped by request']])
})

test('a link whose organization or company is unreadable or unnamed is skipped with its reason, and the rest carry on', async () => {
  const plan = await buildLinkPlan(source({
    links: async () => [
      row('ccl_1', '', 'cco_1', { org: { id: '', name: '' } }),
      row('ccl_2', 'org_a', 'cco_2', { company: { id: 'cco_2', legalName: '  ', contactEmail: null } }),
      row('ccl_3', 'org_a', 'cco_3'),
    ],
  }))
  assert.deepEqual(plan.items.map((i) => i.linkId), ['ccl_3'])
  assert.deepEqual(plan.skipped.map((s) => s.linkId), ['ccl_1', 'ccl_2'])
  assert.ok(plan.skipped.every((s) => s.reason.length > 0))
})

test('applying queues new and changed in order, up to the limit, and leaves the rest for the next run', async () => {
  const store = memoryStore()
  const plan = await buildLinkPlan(source())
  assert.deepEqual(await applyLinkPlan(plan, store, 2), { queued: 2, unchanged: 0 })
  assert.ok(store.byEntity('client_company_link', 'ccl_a') && store.byEntity('client_company_link', 'ccl_b'))
  assert.equal(store.byEntity('client_company_link', 'ccl_c'), undefined)
  const known = new Map([...['ccl_a', 'ccl_b']].map((id) => [id, store.byEntity('client_company_link', id)!.payload_hash] as const))
  const next = await buildLinkPlan(source({ queued: async () => known }))
  assert.deepEqual(await applyLinkPlan(next, store), { queued: 1, unchanged: 2 })
  assert.deepEqual(await applyLinkPlan(await buildLinkPlan(source({ queued: async () => new Map([...known, ['ccl_c', store.byEntity('client_company_link', 'ccl_c')!.payload_hash]]) })), store), { queued: 0, unchanged: 3 })
})

test('applying the same plan twice queues nothing twice, even from a stale plan', async () => {
  const store = memoryStore()
  const plan = await buildLinkPlan(source())
  await applyLinkPlan(plan, store)
  assert.deepEqual(await applyLinkPlan(plan, store), { queued: 0, unchanged: 3 })
})

test('the report names both sides and the domain, counts by status, and lists what is skipped', async () => {
  const lines = describeLinkPlan(await buildLinkPlan(source({ links: async () => [row('ccl_a', 'org_a', 'cco_1'), row('ccl_x', '', 'cco_9', { org: { id: '', name: '' } })] })))
  assert.equal(lines[0], '1 link: 1 new, 0 changed, 0 already queued as they stand.')
  assert.ok(lines.includes('To queue, by link status: active 1. Only active links get a "Uses contractor" edge.'))
  assert.ok(lines.includes('  + Org org_a → Co cco_1 (active, cco1.example.ca) [ccl_a]'))
  assert.ok(lines.some((l) => l.startsWith('  - skipped ccl_x: ')))
})

test('--links is a command line option, and the others still parse', () => {
  assert.deepEqual(parseArgs(['--links', '--queue', '--only', 'org_a']), { command: 'queue', links: true, limit: Infinity, only: ['org_a'], skip: [], yes: false })
  assert.equal((parseArgs(['--queue']) as { links: boolean }).links, false)
})

// ── end to end: plan → queue → drain → Relatrix ────────────────────────────────

let fake: FakeRelatrix
before(async () => {
  fake = await startFakeRelatrix()
})
after(async () => {
  await fake.close()
})
beforeEach(() => {
  fake.reset()
  fake.addUsesType()
})

test('a backfilled link reaches Relatrix as both companies and one edge, and a second backfill sends nothing', async () => {
  const store = memoryStore()
  await applyLinkPlan(await buildLinkPlan(source()), store)
  const client = createRelatrixClient({ baseUrl: fake.url, apiKey: fake.key, timeoutMs: 2000 })
  assert.deepEqual(await drain({ store, handlers, mode: 'live', client }), { delivered: 3, retried: 0, blocked: 0, abandoned: 0, dryRun: 0 })
  const companies = [...fake.companies.values()]
  assert.deepEqual(companies.map((c) => c.name).sort(), ['Co cco_1', 'Co cco_2', 'Org org_a', 'Org org_b'])
  assert.equal(fake.relationships.size, 2, 'two active links make two edges; the invited one makes none')
  // The next run finds all three already queued as they stand, from the queue itself.
  const known = new Map(['ccl_a', 'ccl_b', 'ccl_c'].map((id) => [id, store.byEntity('client_company_link', id)!.payload_hash] as const))
  assert.deepEqual(await applyLinkPlan(await buildLinkPlan(source({ queued: async () => known })), store), { queued: 0, unchanged: 3 })
})
