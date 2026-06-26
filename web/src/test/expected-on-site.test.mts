/**
 * M1 Step 5b — Expected-on-site view + cross-company worker summary (read side).
 *
 * Tests exercise user-JWT Supabase clients to surface any RLS gaps.
 *
 * Test matrix:
 *  1. Client Admin sees activated worker in expected-on-site query (site_worker_activations,
 *     status=active, site in their org)
 *  2. Non-activated worker is absent from the same query (status filter enforced)
 *  3. Client Admin can read an activated worker's users profile via the new
 *     "users: read if activated on org site" policy (migration 0013)
 *  4. worker_company_summary RPC: linked viewer gets correct total_company_count
 *     and shared_companies names (company linked to viewer's org)
 *  5. worker_company_summary RPC: unrelated viewer gets correct total_company_count
 *     but empty shared_companies (no link to their org)
 */

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ulid } from 'ulid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('Missing Supabase env vars')
}

const PASSWORD = 'ExpOnSite123!'
const RUN_ID = ulid().toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const newId = (prefix: string) => `${prefix}${ulid()}`

async function createAuthUser(label: string, meta: Record<string, string>) {
  const email = `step5b-${label}-${RUN_ID}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: meta,
  })
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`)
  return { id: data.user.id, email }
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`signIn(${email}): ${error.message}`)
  return client
}

// ── Fixture state ──────────────────────────────────────────────────────────────
let orgId: string
let unrelatedOrgId: string
let siteId: string
let company1Id: string   // linked to orgId (worker1 is a member)
let company2Id: string   // NOT linked to orgId (worker1 is also a member)
let worker1Id: string    // member of company1 AND company2; activated on site1
let worker2Id: string    // member of company1; NOT activated on site1
let authUserIds: string[] = []

let clientAdminClient: SupabaseClient   // client_admin of orgId
let unrelatedClient: SupabaseClient     // client_admin of unrelatedOrgId

describe('Expected-on-site + cross-company summary — RLS', () => {
  before(async () => {
    orgId = newId('org_')
    unrelatedOrgId = newId('org_')
    siteId = newId('site_')
    company1Id = newId('cco_')
    company2Id = newId('cco_')

    // Orgs
    for (const [id, name] of [
      [orgId, 'Step5b Test Org'],
      [unrelatedOrgId, 'Unrelated Org 5b'],
    ] as [string, string][]) {
      const { error } = await admin.from('organizations').insert({ id, name })
      if (error) throw new Error(`org(${name}): ${error.message}`)
    }

    // Site in orgId
    const { error: siteErr } = await admin.from('sites').insert({
      id: siteId,
      org_id: orgId,
      name: 'Step5b Plant',
    })
    if (siteErr) throw new Error(`site: ${siteErr.message}`)

    // Companies
    for (const [id, name] of [
      [company1Id, 'Company One'],
      [company2Id, 'Company Two'],
    ] as [string, string][]) {
      const { error } = await admin.from('contractor_companies').insert({ id, legal_name: name })
      if (error) throw new Error(`company(${name}): ${error.message}`)
    }

    // Link company1 to orgId only (company2 intentionally unlinked from orgId).
    const { error: linkErr } = await admin.from('client_company_links').insert({
      id: newId('lnk_'),
      org_id: orgId,
      company_id: company1Id,
      status: 'active',
    })
    if (linkErr) throw new Error(`link: ${linkErr.message}`)

    // Assign company1 to site1 (required so contractor_admin can activate workers).
    const { error: assignErr } = await admin.from('site_company_assignments').insert({
      id: newId('sca_'),
      site_id: siteId,
      company_id: company1Id,
      status: 'active',
    })
    if (assignErr) throw new Error(`assignment: ${assignErr.message}`)

    // Auth users
    const clientAdmin = await createAuthUser('ca', { given_name: 'Client', family_name: 'Admin' })
    const unrelated = await createAuthUser('unrelated', {
      given_name: 'Unrelated',
      family_name: 'Client',
    })
    const worker1 = await createAuthUser('w1', { given_name: 'Alice', family_name: 'Worker' })
    const worker2 = await createAuthUser('w2', { given_name: 'Bob', family_name: 'Worker' })

    worker1Id = worker1.id
    worker2Id = worker2.id
    authUserIds = [clientAdmin.id, unrelated.id, worker1.id, worker2.id]

    // Org memberships
    for (const [uid, oid, roles] of [
      [clientAdmin.id, orgId, ['client_admin']],
      [unrelated.id, unrelatedOrgId, ['client_admin']],
    ] as [string, string, string[]][]) {
      const { error } = await admin.from('org_memberships').insert({
        id: newId('mem_'),
        user_id: uid,
        org_id: oid,
        roles,
        status: 'active',
      })
      if (error) throw new Error(`org_membership(${uid}): ${error.message}`)
    }

    // Company memberships:
    //   worker1 → company1 (linked to orgId) AND company2 (not linked)
    //   worker2 → company1 only, NOT activated
    for (const [uid, cid] of [
      [worker1.id, company1Id],
      [worker1.id, company2Id],
      [worker2.id, company1Id],
    ] as [string, string][]) {
      const { error } = await admin.from('company_memberships').insert({
        id: newId('mem_'),
        user_id: uid,
        company_id: cid,
        roles: ['worker'],
        onboarding_status: 'account_created',
        invited_email: `placeholder-${uid}-${cid}@example.com`,
        status: 'active',
      })
      if (error) throw new Error(`company_membership(${uid},${cid}): ${error.message}`)
    }

    // Activate worker1 on site1 (worker2 is intentionally NOT activated).
    const contractorAdminUser = await createAuthUser('cadmin', {
      given_name: 'Contractor',
      family_name: 'Admin',
    })
    authUserIds.push(contractorAdminUser.id)
    await admin.from('company_memberships').insert({
      id: newId('mem_'),
      user_id: contractorAdminUser.id,
      company_id: company1Id,
      roles: ['contractor_admin'],
      onboarding_status: 'account_created',
      invited_email: `placeholder-${contractorAdminUser.id}@example.com`,
      status: 'active',
    })

    const { error: swaErr } = await admin.from('site_worker_activations').insert({
      id: newId('swa_'),
      site_id: siteId,
      company_id: company1Id,
      user_id: worker1.id,
      status: 'active',
      activated_by: contractorAdminUser.id,
    })
    if (swaErr) throw new Error(`activation(worker1): ${swaErr.message}`)

    // Sign in user-JWT clients
    ;[clientAdminClient, unrelatedClient] = await Promise.all([
      signIn(clientAdmin.email),
      signIn(unrelated.email),
    ])
  })

  after(async () => {
    await admin.from('site_worker_activations').delete().eq('site_id', siteId)
    await admin.from('site_company_assignments').delete().eq('site_id', siteId)
    await admin
      .from('client_company_links')
      .delete()
      .in('company_id', [company1Id, company2Id])
    await admin
      .from('company_memberships')
      .delete()
      .in('company_id', [company1Id, company2Id])
    await admin.from('contractor_companies').delete().in('id', [company1Id, company2Id])
    await admin.from('org_memberships').delete().in('org_id', [orgId, unrelatedOrgId])
    await admin.from('sites').delete().eq('id', siteId)
    await admin.from('organizations').delete().in('id', [orgId, unrelatedOrgId])
    for (const uid of authUserIds) await admin.auth.admin.deleteUser(uid)
  })

  // ── Test 1: activated worker appears in expected-on-site query ─────────────

  it('Client Admin sees activated worker in expected-on-site query (status=active)', async () => {
    const { data, error } = await clientAdminClient
      .from('site_worker_activations')
      .select('user_id')
      .eq('site_id', siteId)
      .eq('status', 'active')

    assert.strictEqual(error, null, `Expected no error: ${error?.message}`)
    const userIds = (data ?? []).map((r: { user_id: string }) => r.user_id)
    assert.ok(
      userIds.includes(worker1Id),
      `Expected worker1 in expected-on-site set; got: ${JSON.stringify(userIds)}`,
    )
  })

  // ── Test 2: non-activated worker excluded ──────────────────────────────────

  it('Non-activated worker is absent from expected-on-site query (status filter)', async () => {
    const { data, error } = await clientAdminClient
      .from('site_worker_activations')
      .select('user_id')
      .eq('site_id', siteId)
      .eq('status', 'active')

    assert.strictEqual(error, null, `Expected no error: ${error?.message}`)
    const userIds = (data ?? []).map((r: { user_id: string }) => r.user_id)
    assert.ok(
      !userIds.includes(worker2Id),
      `Expected worker2 to be absent from expected-on-site set; got: ${JSON.stringify(userIds)}`,
    )
  })

  // ── Test 3: Client Admin reads activated worker's profile (migration 0013) ──

  it('Client Admin can read activated worker users profile via "activated on org site" policy', async () => {
    const { data, error } = await clientAdminClient
      .from('users')
      .select('id, given_name, family_name')
      .eq('id', worker1Id)
      .maybeSingle()

    assert.strictEqual(error, null, `Expected no error reading users profile: ${error?.message}`)
    assert.ok(
      data !== null,
      'Expected worker1 profile to be visible to Client Admin via migration 0013 policy',
    )
    const row = data as { id: string; given_name: string; family_name: string }
    assert.strictEqual(row.id, worker1Id)
    assert.strictEqual(row.given_name, 'Alice')
  })

  // ── Test 4: cross-company summary — linked viewer ──────────────────────────

  it('worker_company_summary returns total=2 and shared=[Company One] for linked viewer', async () => {
    const { data, error } = await clientAdminClient.rpc('worker_company_summary', {
      p_worker_id: worker1Id,
    })

    assert.strictEqual(error, null, `Expected RPC to succeed: ${error?.message}`)
    assert.ok(data !== null, 'Expected non-null result from worker_company_summary')

    const summary = data as { total_company_count: number; shared_companies: string[] }
    assert.strictEqual(
      summary.total_company_count,
      2,
      `Expected total_company_count=2 (worker1 is in company1+company2); got ${summary.total_company_count}`,
    )
    assert.deepStrictEqual(
      summary.shared_companies,
      ['Company One'],
      `Expected shared_companies=['Company One'] (only company1 is linked to org); got ${JSON.stringify(summary.shared_companies)}`,
    )
  })

  // ── Test 5: cross-company summary — unrelated viewer ──────────────────────

  it('worker_company_summary returns total=2 and shared=[] for unrelated viewer', async () => {
    const { data, error } = await unrelatedClient.rpc('worker_company_summary', {
      p_worker_id: worker1Id,
    })

    assert.strictEqual(error, null, `Expected RPC to succeed: ${error?.message}`)
    assert.ok(data !== null, 'Expected non-null result from worker_company_summary')

    const summary = data as { total_company_count: number; shared_companies: string[] }
    assert.strictEqual(
      summary.total_company_count,
      2,
      `Expected total_company_count=2; got ${summary.total_company_count}`,
    )
    assert.deepStrictEqual(
      summary.shared_companies,
      [],
      `Expected shared_companies=[] for unrelated viewer; got ${JSON.stringify(summary.shared_companies)}`,
    )
  })
})
