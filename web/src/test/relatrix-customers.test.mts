import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRelatrixClient } from '../lib/relatrix/client.ts'
import { orgLifecyclePayload } from '../lib/relatrix/lifecycle.ts'
import { CUSTOMER_PIPELINE, handlers, parseOrgCustomer } from '../lib/relatrix/ops.ts'
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
  fake.addCustomerPipeline()
  store = memoryStore()
})

const client = () => createRelatrixClient({ baseUrl: fake.url, apiKey: fake.key, timeoutMs: 2000 })
const live = () => drain({ store, handlers, mode: 'live', client: client() })
const row = () => store.byEntity('client_org', 'org_1')!
const stageId = (name: string) => fake.pipelines[0]!.stages.find((s) => s.name === name)!.id
const stageName = (id: string) => fake.pipelines[0]!.stages.find((s) => s.id === id)!.name
const deal = () => [...fake.deals.values()][0]!

const T = { signed: '2026-10-01T10:00:00.000Z', site: '2026-10-02T10:00:00.000Z', pkg: '2026-10-03T10:00:00.000Z', invite: '2026-10-04T10:00:00.000Z' }
const org = (milestones: Record<string, string> = { signed_up: T.signed }, name = 'Northwind Energy') => ({ contrak_org_id: 'org_1', name, milestones })
const queue = (payload: unknown = org()) => store.enqueue('client_org', 'org_1', 'org.customer', payload)

// ── the wanted state, from the database's facts ────────────────────────────

test('the lifecycle is worked out from when each milestone was first reached, and only those reached', () => {
  const base = { id: 'org_1', name: 'Northwind', createdAt: '2026-10-01T10:00:00+00:00' }
  assert.deepEqual(orgLifecyclePayload(base, { firstSite: null, firstPackage: null, firstContractorInvite: null }).milestones, { signed_up: T.signed })
  assert.deepEqual(
    orgLifecyclePayload(base, { firstSite: T.site, firstPackage: null, firstContractorInvite: T.invite }).milestones,
    { signed_up: T.signed, onboarding: T.site, adopting: T.invite },
  )
  assert.equal(orgLifecyclePayload(base, { firstSite: null, firstPackage: T.pkg, firstContractorInvite: null }).milestones.live, T.pkg)
})

test('recomputing the same facts gives the same payload, so queueing again is a no-op', async () => {
  const base = { id: 'org_1', name: 'Northwind', createdAt: T.signed }
  const dates = { firstSite: T.site, firstPackage: null, firstContractorInvite: null }
  assert.equal(await queue(orgLifecyclePayload(base, dates)), 'queued')
  assert.equal(await queue(orgLifecyclePayload(base, dates)), 'unchanged')
  assert.equal(await queue(orgLifecyclePayload(base, { ...dates, firstPackage: T.pkg })), 'queued')
})

test('a payload is checked: an organization, a name, real dates, known milestones, and always signed up', () => {
  assert.deepEqual(parseOrgCustomer(org({ signed_up: '2026-10-01T10:00:00+00:00' })).milestones, { signed_up: T.signed })
  for (const bad of [null, {}, { contrak_org_id: 'o', name: 'n' }, { contrak_org_id: 'o', name: 'n', milestones: {} }, { contrak_org_id: 'o', name: 'n', milestones: { onboarding: T.site } },
    { contrak_org_id: 'o', name: 'n', milestones: { signed_up: 'yesterday' } }, { contrak_org_id: 'o', name: 'n', milestones: { signed_up: T.signed, won: T.site } },
    { contrak_org_id: '', name: 'n', milestones: { signed_up: T.signed } }, { contrak_org_id: 'o', name: 'x'.repeat(191), milestones: { signed_up: T.signed } }]) {
    assert.throws(() => parseOrgCustomer(bad), { name: 'InvalidPayload' }, JSON.stringify(bad))
  }
})

// ── a new customer ─────────────────────────────────────────────────────────

test('a new organization becomes a flagged company and a deal in Signed up, with a note, and nothing else', async () => {
  await queue()
  assert.deepEqual(await live(), { delivered: 1, retried: 0, blocked: 0, abandoned: 0, dryRun: 0 })

  const [company] = [...fake.companies.values()]
  assert.deepEqual({ name: company!.name, source: company!.source, tags: company!.tags, refs: company!.external_refs }, {
    name: 'Northwind Energy', source: 'contrak', tags: ['client', 'contrak'], refs: { contrak_org: 'org_1' },
  })
  assert.equal(fake.deals.size, 1)
  assert.deepEqual(
    { title: deal().title, currency: deal().currency, stage: stageName(deal().stage_id), company: deal().company_id, refs: deal().external_refs },
    { title: 'Northwind Energy (ConTrak)', currency: 'CAD', stage: 'Signed up', company: company!.id, refs: { contrak_org: 'org_1', contrak_stage: stageId('Signed up') } },
  )
  assert.equal(fake.pipelines.length, 1)
  assert.equal(fake.activities.length, 1)
  assert.deepEqual({ kind: fake.activities[0]!.kind, subject: fake.activities[0]!.subject, at: fake.activities[0]!.occurred_at, deal: fake.activities[0]!.deal_id },
    { kind: 'note', subject: 'ConTrak: signed up to ConTrak', at: T.signed, deal: deal().id })
  assert.equal(row().status, 'delivered')
  assert.equal(row().remote_id, deal().id)
})

test('it creates no deal on any pipeline but “ConTrak customers”, and no contact', async () => {
  fake.pipelines.push({ id: '00000000-0000-4000-b000-0000000000ff', name: 'Main sales', stages: [{ id: '00000000-0000-4000-b000-0000000000fe', name: 'Signed up', position: 1 }] })
  await queue()
  await live()
  assert.equal(deal().pipeline_id, fake.pipelines.find((p) => p.name === CUSTOMER_PIPELINE)!.id)
  assert.equal(fake.requests.some((r) => /contacts/.test(r.url)), false)
})

test('a customer that already finished everything arrives in the furthest stage, with a note for each milestone', async () => {
  await queue(org({ signed_up: T.signed, onboarding: T.site, live: T.pkg, adopting: T.invite }))
  await live()
  assert.equal(stageName(deal().stage_id), 'Adopting')
  assert.deepEqual(fake.activities.map((a) => a.subject), [
    'ConTrak: signed up to ConTrak', 'ConTrak: added its first site', 'ConTrak: published its first orientation package', 'ConTrak: invited its first contractor',
  ])
})

test('the furthest stage is by the pipeline’s own order, not by the order milestones happen', async () => {
  fake.reset()
  const p = fake.addCustomerPipeline(['Signed up', 'Onboarding', 'Adopting', 'Live'])
  assert.deepEqual(p.stages.map((s) => s.name), ['Signed up', 'Onboarding', 'Adopting', 'Live'])
  await queue(org({ signed_up: T.signed, live: T.pkg, adopting: T.invite }))
  await live()
  assert.equal(p.stages.find((st) => st.id === deal().stage_id)!.name, 'Live')
})

// ── following the organization ─────────────────────────────────────────────

test('a milestone moves the deal forward, notes only the new one, and makes no second deal or company', async () => {
  await queue()
  await live()
  assert.equal(await queue(org({ signed_up: T.signed, onboarding: T.site })), 'queued')
  await live()
  assert.equal(stageName(deal().stage_id), 'Onboarding')
  // Relatrix replaces the whole map on a PATCH, so the link back to ConTrak must survive the update.
  assert.deepEqual(deal().external_refs, { contrak_org: 'org_1', contrak_stage: stageId('Onboarding') })
  assert.deepEqual(fake.moves, [{ deal: deal().id, stage: stageId('Onboarding') }])
  assert.equal(fake.deals.size, 1)
  assert.equal(fake.companies.size, 1)
  assert.equal(fake.activities.length, 2, 'the sign-up note is not written twice')
  assert.deepEqual(fake.activities.map((a) => a.subject), ['ConTrak: signed up to ConTrak', 'ConTrak: added its first site'])
})

test('a renamed organization renames its company, and keeps what Ron added to it', async () => {
  await queue()
  await live()
  const company = [...fake.companies.values()][0]!
  company.tags = ['client', 'contrak', 'vip']
  await queue(org({ signed_up: T.signed }, 'Northwind Energy Ltd'))
  await live()
  assert.equal(company.name, 'Northwind Energy Ltd')
  assert.deepEqual(company.tags, ['client', 'contrak', 'vip'])
  assert.equal(fake.companies.size, 1)
})

// ── never override a person ────────────────────────────────────────────────

test('a deal Ron moved is left where he put it; the milestone is still noted', async () => {
  await queue()
  await live()
  deal().stage_id = stageId('Live') // Ron moved it
  await queue(org({ signed_up: T.signed, onboarding: T.site }))
  await live()
  assert.equal(stageName(deal().stage_id), 'Live')
  assert.deepEqual(fake.moves, [])
  assert.equal(deal().external_refs.contrak_stage, stageId('Signed up'), 'ConTrak does not claim a stage it did not set')
  assert.equal(fake.activities.length, 2)
})

test('a deal Ron moved back to an earlier stage is not pulled forward again, even though the target is ahead of it', async () => {
  await queue(org({ signed_up: T.signed, onboarding: T.site }))
  await live()
  assert.equal(stageName(deal().stage_id), 'Onboarding')
  deal().stage_id = stageId('Signed up') // Ron put it back
  const moves = fake.moves.length
  await queue(org({ signed_up: T.signed, onboarding: T.site, live: T.pkg }))
  await live()
  assert.equal(stageName(deal().stage_id), 'Signed up')
  assert.equal(fake.moves.length, moves)
})

test('ConTrak never moves a deal backward, even one it left behind', async () => {
  await queue(org({ signed_up: T.signed, onboarding: T.site, live: T.pkg }))
  await live()
  assert.equal(stageName(deal().stage_id), 'Live')
  // Facts that look earlier (a site deleted) change nothing: the state is "furthest reached", never lower than where it is.
  await queue(org({ signed_up: T.signed, onboarding: T.site }))
  await live()
  assert.equal(stageName(deal().stage_id), 'Live')
  assert.deepEqual(fake.moves, [])
})

test('a deal Ron has closed is not moved or reopened', async () => {
  await queue()
  await live()
  deal().closed_at = '2026-10-05T00:00:00Z'
  await queue(org({ signed_up: T.signed, onboarding: T.site }))
  await live()
  assert.equal(stageName(deal().stage_id), 'Signed up')
  assert.deepEqual(fake.moves, [])
})

test('a deal made by hand without ConTrak’s marker is moved only if it is still ahead of nothing it set', async () => {
  await queue()
  await live()
  delete deal().external_refs.contrak_stage // never recorded by ConTrak
  await queue(org({ signed_up: T.signed, onboarding: T.site }))
  await live()
  assert.equal(stageName(deal().stage_id), 'Onboarding')
})

// ── replays ────────────────────────────────────────────────────────────────

test('a replay after a lost answer makes no second company, deal or note', async () => {
  await queue(org({ signed_up: T.signed, onboarding: T.site }))
  await live()
  row().status = 'pending'
  row().attempts = 0
  await live()
  assert.equal(fake.companies.size, 1)
  assert.equal(fake.deals.size, 1)
  assert.equal(fake.activities.length, 2)
  assert.equal(fake.moves.length, 0, 'it was created in Onboarding: nothing to move')
})

test('a failure partway through is retried and finishes the rest without repeating what went through', async () => {
  await queue(org({ signed_up: T.signed, onboarding: T.site }))
  // pipelines, company lookup, company create, deal lookup and deal create go through; the first note fails.
  fake.setFail([-2, -2, -2, -2, -2, 503])
  assert.deepEqual(await live(), { delivered: 0, retried: 1, blocked: 0, abandoned: 0, dryRun: 0 })
  assert.deepEqual({ companies: fake.companies.size, deals: fake.deals.size, notes: fake.activities.length }, { companies: 1, deals: 1, notes: 0 })

  store.clock.now += 31
  assert.equal((await live()).delivered, 1)
  assert.deepEqual({ companies: fake.companies.size, deals: fake.deals.size, notes: fake.activities.length }, { companies: 1, deals: 1, notes: 2 })
})

// ── set-up problems are for Ron to fix, not retried into the ground ───────

test('no “ConTrak customers” pipeline blocks the sync with a plain instruction, and it goes through once Ron makes one', async () => {
  fake.pipelines.length = 0
  await queue()
  assert.deepEqual(await live(), { delivered: 0, retried: 0, blocked: 1, abandoned: 0, dryRun: 0 })
  assert.equal(row().status, 'blocked')
  assert.equal(row().attempts, 0)
  assert.match(row().last_error!, /no pipeline called “ConTrak customers” in Relatrix/)
  assert.match(row().last_error!, /Set it up in Relatrix/)
  assert.equal(fake.companies.size, 0, 'nothing was created before the check')
  fake.addCustomerPipeline()
  store.clock.now += 1000
  assert.equal((await live()).delivered, 1)
})

test('a missing stage is named, and nothing is created until it exists', async () => {
  fake.reset()
  fake.addCustomerPipeline(['Signed up', 'Onboarding', 'Live'])
  await queue(org({ signed_up: T.signed, adopting: T.invite }))
  await live()
  assert.equal(row().status, 'blocked')
  assert.match(row().last_error!, /no stage called “Adopting”/)
  assert.equal(fake.deals.size, 0)
  assert.equal(fake.companies.size, 0)
})

test('two pipelines with the name is a set-up problem, not a guess', async () => {
  fake.addCustomerPipeline()
  await queue()
  await live()
  assert.equal(row().status, 'blocked')
  assert.match(row().last_error!, /more than one pipeline/)
})

// ── dry run ────────────────────────────────────────────────────────────────

test('a dry run says what it would do, and sends nothing', async () => {
  await queue(org({ signed_up: T.signed, onboarding: T.site }))
  await drain({ store, handlers, mode: 'dry-run', client: null })
  assert.equal(row().status, 'dry_run')
  assert.match(row().last_error!, /Would create or update the Relatrix company “Northwind Energy” \(ConTrak org org_1\) and its deal on “ConTrak customers”, in Onboarding \(reached: Signed up, Onboarding\)/)
  assert.equal(fake.requests.length, 0)
})

// ── privacy ────────────────────────────────────────────────────────────────

test('only the organization’s name and milestone dates are ever sent: no person, no site, no contractor', async () => {
  await queue({ ...org({ signed_up: T.signed, onboarding: T.site }), admin_email: 'pat@northwind.example', site_names: ['North Plant'], contractors: ['Apex'] })
  await live()
  const sent = JSON.stringify(fake.requests.map((r) => r.body))
  for (const leak of ['pat@northwind.example', 'North Plant', 'Apex', 'admin_email', 'site_names']) assert.equal(sent.includes(leak), false, leak)
})
