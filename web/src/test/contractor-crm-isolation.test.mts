// Regression net (CLAUDE.md §7): proves relationship-derived RLS for M1 tables.
// Verifies HowDesign-DataModel.md §4.2–4.3:
//   - A company's data is readable by its own members.
//   - A linked client sees the same rows (the "sliced view" is enforced at the app layer,
//     not via additional RLS row-filtering — RLS grants access; the app narrows it).
//   - An unrelated client sees nothing.
//
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local via `node --env-file`).
// Seeds throwaway rows via the admin API and deletes them in after().

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ulid } from 'ulid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const PASSWORD = 'IsolationTest123!'
const RUN_ID = ulid().toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── Fixture state ─────────────────────────────────────────────────────────────

// Linked client: has an active client_company_link to the contractor company
let linkedClientUserId!: string
let linkedClientOrgId!: string
let linkedClientMembershipId!: string
let linkedClient!: SupabaseClient

// Unrelated client: no relationship to the contractor company
let unrelatedClientUserId!: string
let unrelatedClientOrgId!: string
let unrelatedClient!: SupabaseClient

// Contractor admin: a member of the contractor company
let contractorAdminUserId!: string
let contractorClient!: SupabaseClient

// Contractor worker: a regular member of the contractor company
let workerUserId!: string

let companyId!: string
let contractorAdminMembershipId!: string
let workerMembershipId!: string
let linkId!: string

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createAuthUser(label: string, meta: Record<string, string>) {
  const email = `crm-isolation-${label}-${RUN_ID}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: meta,
  })
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`)
  return data.user.id
}

async function signIn(userId: string, label: string): Promise<SupabaseClient> {
  const email = `crm-isolation-${label}-${RUN_ID}@example.com`
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`signIn(${label}): ${error.message}`)
  return client
}

// ── Setup ─────────────────────────────────────────────────────────────────────

before(async () => {
  // 1. Linked client org + user
  linkedClientUserId = await createAuthUser('linked-client', {
    given_name: 'Linked',
    family_name: 'Client',
  })
  linkedClientOrgId = `org_${ulid()}`
  linkedClientMembershipId = `mem_${ulid()}`
  linkedClient = await signIn(linkedClientUserId, 'linked-client')
  const { error: orgErr } = await linkedClient.rpc('create_organization', {
    p_org_id: linkedClientOrgId,
    p_org_name: 'Linked Client Org',
    p_membership_id: linkedClientMembershipId,
  })
  if (orgErr) throw new Error(`create_organization(linked): ${orgErr.message}`)

  // 2. Unrelated client org + user
  unrelatedClientUserId = await createAuthUser('unrelated-client', {
    given_name: 'Unrelated',
    family_name: 'Client',
  })
  unrelatedClientOrgId = `org_${ulid()}`
  unrelatedClient = await signIn(unrelatedClientUserId, 'unrelated-client')
  const { error: orgErr2 } = await unrelatedClient.rpc('create_organization', {
    p_org_id: unrelatedClientOrgId,
    p_org_name: 'Unrelated Client Org',
    p_membership_id: `mem_${ulid()}`,
  })
  if (orgErr2) throw new Error(`create_organization(unrelated): ${orgErr2.message}`)

  // 3. Contractor admin user + contractor company (service role: no registration RPC yet)
  contractorAdminUserId = await createAuthUser('contractor-admin', {
    given_name: 'Contractor',
    family_name: 'Admin',
  })
  contractorClient = await signIn(contractorAdminUserId, 'contractor-admin')

  companyId = `cco_${ulid()}`
  const { error: coErr } = await admin.from('contractor_companies').insert({
    id: companyId,
    legal_name: `Isolation Test Co ${RUN_ID}`,
    status: 'active',
  })
  if (coErr) throw new Error(`contractor_companies insert: ${coErr.message}`)

  contractorAdminMembershipId = `mem_${ulid()}`
  const { error: adminMemErr } = await admin.from('company_memberships').insert({
    id: contractorAdminMembershipId,
    user_id: contractorAdminUserId,
    company_id: companyId,
    roles: ['contractor_admin'],
    status: 'active',
    onboarding_status: 'account_created',
  })
  if (adminMemErr) throw new Error(`company_memberships(admin): ${adminMemErr.message}`)

  // 4. Contractor worker
  workerUserId = await createAuthUser('worker', { given_name: 'Test', family_name: 'Worker' })
  workerMembershipId = `mem_${ulid()}`
  const { error: workerMemErr } = await admin.from('company_memberships').insert({
    id: workerMembershipId,
    user_id: workerUserId,
    company_id: companyId,
    roles: ['worker'],
    status: 'active',
    onboarding_status: 'account_created',
  })
  if (workerMemErr) throw new Error(`company_memberships(worker): ${workerMemErr.message}`)

  // 5. Active link between linked client org and the contractor company
  linkId = `lnk_${ulid()}`
  const { error: linkErr } = await admin.from('client_company_links').insert({
    id: linkId,
    org_id: linkedClientOrgId,
    company_id: companyId,
    status: 'active',
  })
  if (linkErr) throw new Error(`client_company_links insert: ${linkErr.message}`)
})

after(async () => {
  // Delete in dependency order
  if (linkId) await admin.from('client_company_links').delete().eq('id', linkId)
  if (companyId) {
    await admin.from('company_memberships').delete().eq('company_id', companyId)
    await admin.from('contractor_companies').delete().eq('id', companyId)
  }
  const orgIds = [linkedClientOrgId, unrelatedClientOrgId].filter(Boolean)
  if (orgIds.length) {
    await admin.from('org_memberships').delete().in('org_id', orgIds)
    await admin.from('organizations').delete().in('id', orgIds)
  }
  const userIds = [
    linkedClientUserId,
    unrelatedClientUserId,
    contractorAdminUserId,
    workerUserId,
  ].filter(Boolean)
  for (const id of userIds) {
    await admin.from('users').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id)
  }
})

// ── contractor_companies ──────────────────────────────────────────────────────

test('contractor admin can read their own company', async () => {
  const { data, error } = await contractorClient
    .from('contractor_companies')
    .select('id')
    .eq('id', companyId)
  assert.equal(error, null)
  assert.deepEqual(
    data?.map((r) => r.id),
    [companyId],
  )
})

test('linked client can read the contractor company', async () => {
  const { data, error } = await linkedClient
    .from('contractor_companies')
    .select('id')
    .eq('id', companyId)
  assert.equal(error, null)
  assert.deepEqual(
    data?.map((r) => r.id),
    [companyId],
  )
})

test('unrelated client cannot read the contractor company', async () => {
  const { data, error } = await unrelatedClient
    .from('contractor_companies')
    .select('id')
    .eq('id', companyId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("unrelated client's unfiltered contractor_companies listing is empty", async () => {
  const { data } = await unrelatedClient.from('contractor_companies').select('id')
  assert.deepEqual(data, [])
})

// ── company_memberships ───────────────────────────────────────────────────────

test('contractor admin can read memberships for their company', async () => {
  const { data, error } = await contractorClient
    .from('company_memberships')
    .select('id')
    .eq('company_id', companyId)
  assert.equal(error, null)
  const ids = data?.map((r) => r.id).sort()
  assert.deepEqual(ids, [contractorAdminMembershipId, workerMembershipId].sort())
})

test('linked client can read company_memberships for the linked company', async () => {
  const { data, error } = await linkedClient
    .from('company_memberships')
    .select('id')
    .eq('company_id', companyId)
  assert.equal(error, null)
  // linked client sees both memberships (app layer narrows to count/name slice)
  const ids = data?.map((r) => r.id).sort()
  assert.deepEqual(ids, [contractorAdminMembershipId, workerMembershipId].sort())
})

test('unrelated client cannot read company_memberships for an unlinked company', async () => {
  const { data, error } = await unrelatedClient
    .from('company_memberships')
    .select('id')
    .eq('company_id', companyId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

// ── client_company_links ──────────────────────────────────────────────────────

test('linked client can see their own client_company_link', async () => {
  const { data, error } = await linkedClient
    .from('client_company_links')
    .select('id')
    .eq('id', linkId)
  assert.equal(error, null)
  assert.deepEqual(
    data?.map((r) => r.id),
    [linkId],
  )
})

test('contractor admin can see the client_company_link to their company', async () => {
  const { data, error } = await contractorClient
    .from('client_company_links')
    .select('id')
    .eq('id', linkId)
  assert.equal(error, null)
  assert.deepEqual(
    data?.map((r) => r.id),
    [linkId],
  )
})

test('unrelated client cannot see the client_company_link', async () => {
  const { data, error } = await unrelatedClient
    .from('client_company_links')
    .select('id')
    .eq('id', linkId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

// ── write isolation ───────────────────────────────────────────────────────────

test('unrelated client cannot insert a contractor_company row directly', async () => {
  const { error } = await unrelatedClient.from('contractor_companies').insert({
    id: `cco_${ulid()}`,
    legal_name: 'Hostile Co',
    status: 'active',
  })
  assert.ok(error, 'expected RLS to reject the insert')

  // Confirm no row was created
  const { data: leaked } = await admin
    .from('contractor_companies')
    .select('id')
    .eq('legal_name', 'Hostile Co')
  assert.deepEqual(leaked, [])
})

test('unrelated client cannot insert a client_company_link for a foreign org', async () => {
  // Tries to link unrelated client's own org to the contractor company — even though
  // the org_id belongs to the inserter, the company has no prior link, so this tests
  // whether a client can freely link themselves to any company.
  // The INSERT policy requires client_admin on the org_id; unrelated client IS admin
  // of their org but that's legitimate — this insert SHOULD succeed.
  // What must NOT succeed: linking ANOTHER org.
  const { error } = await unrelatedClient.from('client_company_links').insert({
    id: `lnk_${ulid()}`,
    org_id: linkedClientOrgId, // foreign org — not their own
    company_id: companyId,
    status: 'active',
  })
  assert.ok(error, 'expected RLS to reject linking a foreign org')
})

test('linked client cannot write a company_membership into the contractor company', async () => {
  const { error } = await linkedClient.from('company_memberships').insert({
    id: `mem_${ulid()}`,
    user_id: linkedClientUserId,
    company_id: companyId,
    roles: ['contractor_admin'],
    status: 'active',
    onboarding_status: 'account_created',
  })
  assert.ok(error, 'expected RLS to reject: linked client is not a contractor_admin')
})
