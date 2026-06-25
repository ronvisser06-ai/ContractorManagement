/**
 * M1 Step 5a — Site↔company assignment + worker activation (write side).
 *
 * Tests exercise user-JWT Supabase clients to surface any RLS gaps, as required
 * by the Step 5a working agreement.
 *
 * Note: the business-logic gate ("company must be assigned to the site" before a
 * worker can be activated) is enforced by the server action, not by RLS. The RLS
 * for site_worker_activations only checks that company_id belongs to the caller's
 * contractor_admin company. Tests 4 and 5 cover the RLS layer; action-level
 * enforcement is verified manually in the UI.
 *
 * Test matrix:
 *  1. Client Admin (user-JWT) can write site_company_assignments (INSERT succeeds)
 *  2. Client Admin can remove an assignment (UPDATE status='removed' succeeds)
 *  3. Unrelated client (wrong org) cannot write to another org's site assignments (RLS blocks)
 *  4. Contractor Admin (user-JWT) can write site_worker_activations (INSERT succeeds)
 *  5. Wrong-company contractor cannot create activations for another company (RLS blocks)
 *  6. Contractor Admin can read sites their company is assigned to (migration 0012 policy)
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

const PASSWORD = 'CrewActivate123!'
const RUN_ID = ulid().toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const newId = (prefix: string) => `${prefix}${ulid()}`

async function createAuthUser(label: string, meta: Record<string, string>) {
  const email = `crew-act-${label}-${RUN_ID}@example.com`
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

// ── Fixture IDs ────────────────────────────────────────────────────────────────
let orgId: string
let siteId: string
let unrelatedOrgId: string
let company1Id: string
let company2Id: string
let worker1Id: string
let baseAssignmentId: string
let authUserIds: string[] = []

// User-JWT clients
let clientClient: SupabaseClient       // client_admin of orgId
let unrelatedClient: SupabaseClient    // client_admin of unrelatedOrgId (no link to site)
let contractor1Client: SupabaseClient  // contractor_admin of company1Id
let contractor2Client: SupabaseClient  // contractor_admin of company2Id

describe('Crew activation — RLS (site_company_assignments + site_worker_activations)', () => {
  before(async () => {
    // ── Org + site ──────────────────────────────────────────────────────────
    orgId = newId('org_')
    siteId = newId('site_')
    unrelatedOrgId = newId('org_')

    for (const [id, name] of [
      [orgId, 'Crew Test Org'],
      [unrelatedOrgId, 'Unrelated Org'],
    ] as [string, string][]) {
      const { error } = await admin.from('organizations').insert({ id, name })
      if (error) throw new Error(`org(${name}): ${error.message}`)
    }

    const { error: siteErr } = await admin.from('sites').insert({
      id: siteId,
      org_id: orgId,
      name: 'Main Plant',
    })
    if (siteErr) throw new Error(`site: ${siteErr.message}`)

    // ── Companies ──────────────────────────────────────────────────────────
    company1Id = newId('cco_')
    company2Id = newId('cco_')

    for (const [id, name] of [
      [company1Id, 'Crew Company One'],
      [company2Id, 'Crew Company Two'],
    ] as [string, string][]) {
      const { error } = await admin.from('contractor_companies').insert({ id, legal_name: name })
      if (error) throw new Error(`company(${name}): ${error.message}`)
    }

    // Link company1 to orgId (company2 is intentionally unlinked)
    const { error: linkErr } = await admin.from('client_company_links').insert({
      id: newId('lnk_'),
      org_id: orgId,
      company_id: company1Id,
      status: 'active',
    })
    if (linkErr) throw new Error(`link: ${linkErr.message}`)

    // ── Auth users ─────────────────────────────────────────────────────────
    const clientAdmin = await createAuthUser('ca', { given_name: 'Client', family_name: 'Admin' })
    const unrelated = await createAuthUser('unrelated', {
      given_name: 'Unrelated',
      family_name: 'Admin',
    })
    const contractorAdmin1 = await createAuthUser('ca1', {
      given_name: 'Contractor',
      family_name: 'Admin1',
    })
    const contractorAdmin2 = await createAuthUser('ca2', {
      given_name: 'Contractor',
      family_name: 'Admin2',
    })
    const worker1 = await createAuthUser('w1', { given_name: 'Worker', family_name: 'One' })
    worker1Id = worker1.id

    authUserIds = [
      clientAdmin.id,
      unrelated.id,
      contractorAdmin1.id,
      contractorAdmin2.id,
      worker1.id,
    ]

    // ── Memberships ────────────────────────────────────────────────────────
    const orgMembers = [
      [clientAdmin.id, orgId, ['client_admin']],
      [unrelated.id, unrelatedOrgId, ['client_admin']],
    ] as [string, string, string[]][]

    for (const [uid, oid, roles] of orgMembers) {
      const { error } = await admin.from('org_memberships').insert({
        id: newId('mem_'),
        user_id: uid,
        org_id: oid,
        roles,
        status: 'active',
      })
      if (error) throw new Error(`org_membership(${uid}): ${error.message}`)
    }

    const companyMembers = [
      [contractorAdmin1.id, company1Id, ['contractor_admin']],
      [contractorAdmin2.id, company2Id, ['contractor_admin']],
      [worker1.id, company1Id, ['worker']],
    ] as [string, string, string[]][]

    for (const [uid, cid, roles] of companyMembers) {
      const { error } = await admin.from('company_memberships').insert({
        id: newId('mem_'),
        user_id: uid,
        company_id: cid,
        roles,
        onboarding_status: 'account_created',
        invited_email: `placeholder-${uid}@example.com`,
        status: 'active',
      })
      if (error) throw new Error(`company_membership(${uid}): ${error.message}`)
    }

    // ── Base assignment: company1 assigned to site1 (used in tests 4, 5, 6) ──
    baseAssignmentId = newId('sca_')
    const { error: assignErr } = await admin.from('site_company_assignments').insert({
      id: baseAssignmentId,
      site_id: siteId,
      company_id: company1Id,
      status: 'active',
    })
    if (assignErr) throw new Error(`base assignment: ${assignErr.message}`)

    // ── Sign in all user-JWT clients ────────────────────────────────────────
    ;[clientClient, unrelatedClient, contractor1Client, contractor2Client] = await Promise.all([
      signIn(clientAdmin.email),
      signIn(unrelated.email),
      signIn(contractorAdmin1.email),
      signIn(contractorAdmin2.email),
    ])
  })

  after(async () => {
    // Clean up in FK order
    await admin.from('site_worker_activations').delete().eq('site_id', siteId)
    await admin.from('site_company_assignments').delete().eq('site_id', siteId)
    await admin.from('client_company_links').delete().in('company_id', [company1Id, company2Id])
    await admin.from('company_memberships').delete().in('company_id', [company1Id, company2Id])
    await admin.from('contractor_companies').delete().in('id', [company1Id, company2Id])
    await admin.from('org_memberships').delete().in('org_id', [orgId, unrelatedOrgId])
    await admin.from('sites').delete().eq('id', siteId)
    await admin.from('organizations').delete().in('id', [orgId, unrelatedOrgId])
    for (const uid of authUserIds) await admin.auth.admin.deleteUser(uid)
  })

  // ── Test 1: Client Admin can assign a company to a site ───────────────────

  it('Client Admin (user-JWT) can insert a site_company_assignment', async () => {
    // Use company2 so it doesn't conflict with the base assignment (site1+company1).
    // RLS only checks site→org ownership; the link check is the action's responsibility.
    const insertId = newId('sca_')
    const { error } = await clientClient.from('site_company_assignments').insert({
      id: insertId,
      site_id: siteId,
      company_id: company2Id,
      status: 'active',
    })
    assert.strictEqual(error, null, `Expected insert to succeed: ${error?.message}`)

    // Clean up immediately so test 2 can work on the base assignment
    await admin.from('site_company_assignments').delete().eq('id', insertId)
  })

  // ── Test 2: Client Admin can remove an assignment ─────────────────────────

  it('Client Admin (user-JWT) can update assignment status to removed', async () => {
    // Temporarily insert a fresh assignment to update
    const tempId = newId('sca_')
    await admin.from('site_company_assignments').insert({
      id: tempId,
      site_id: siteId,
      company_id: company2Id,
      status: 'active',
    })

    const { error } = await clientClient
      .from('site_company_assignments')
      .update({ status: 'removed' })
      .eq('id', tempId)
    assert.strictEqual(error, null, `Expected update to succeed: ${error?.message}`)

    await admin.from('site_company_assignments').delete().eq('id', tempId)
  })

  // ── Test 3: Unrelated client cannot write to another org's site ───────────

  it('Unrelated client (wrong org) cannot write site_company_assignments for another org site (RLS blocks)', async () => {
    // unrelatedClient is client_admin of unrelatedOrgId, not orgId.
    // siteId belongs to orgId — the RLS check will fail.
    const { error } = await unrelatedClient.from('site_company_assignments').insert({
      id: newId('sca_'),
      site_id: siteId,
      company_id: company1Id,
      status: 'active',
    })
    assert.ok(error !== null, 'Expected RLS to block insert from unrelated client')
  })

  // ── Test 4: Contractor Admin can activate a worker ────────────────────────

  it('Contractor Admin (user-JWT) can insert a site_worker_activation for their company', async () => {
    // RLS: company1Id is in contractor1's company_memberships as contractor_admin → passes.
    // (Action would also check site assignment, but we're testing the RLS layer here.)
    const { error } = await contractor1Client.from('site_worker_activations').insert({
      id: newId('swa_'),
      site_id: siteId,
      company_id: company1Id,
      user_id: worker1Id,
      status: 'active',
      activated_by: (await contractor1Client.auth.getUser()).data.user!.id,
    })
    assert.strictEqual(error, null, `Expected insert to succeed: ${error?.message}`)
  })

  // ── Test 5: Wrong-company contractor cannot create activations for another company ──

  it('Wrong-company contractor cannot insert site_worker_activation for a company they do not own (RLS blocks)', async () => {
    // contractor2Client is contractor_admin of company2, not company1.
    // Inserting with company_id=company1 should fail the RLS check.
    const { error } = await contractor2Client.from('site_worker_activations').insert({
      id: newId('swa_'),
      site_id: siteId,
      company_id: company1Id,
      user_id: worker1Id,
      status: 'active',
      activated_by: (await contractor2Client.auth.getUser()).data.user!.id,
    })
    assert.ok(error !== null, 'Expected RLS to block cross-company activation attempt')
  })

  // ── Test 6: Contractor Admin can read sites their company is assigned to ──

  it('Contractor Admin can read sites their company is assigned to (migration 0012 policy)', async () => {
    // baseAssignmentId links company1 to siteId.
    // The new "sites: read if company assigned" policy should expose siteId to contractor1.
    const { data, error } = await contractor1Client
      .from('sites')
      .select('id, name')
      .eq('id', siteId)
      .maybeSingle()

    assert.strictEqual(error, null, `Expected site read to succeed: ${error?.message}`)
    assert.ok(data !== null, 'Expected site to be visible to contractor Admin via company assignment')
    assert.strictEqual((data as { id: string; name: string }).id, siteId)
  })
})
