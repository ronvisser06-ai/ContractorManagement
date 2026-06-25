/**
 * M1 Step 4b — Worker invite claim + soft-match + Client Admin sliced view.
 *
 * Tests exercise both the claim_worker_invite RPC directly (for atomic DB behaviour)
 * and user-JWT Supabase clients (to surface any RLS recursion, as required by the
 * Step 4b working agreement).
 *
 * Test matrix:
 *  1. Valid claim: RPC advances onboarding_status to account_created + consumes invite
 *  2. Expired token: RPC raises 'expired'
 *  3. Already-used token: RPC raises 'already_used'
 *  4. Soft-match merge: RPC re-points membership to existing user, provisional is gone
 *  5. Client Admin (linked org) can read sliced worker memberships via user-JWT (RLS)
 *  6. Unrelated client cannot read worker memberships for an unlinked company (RLS blocks)
 */

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('Missing Supabase env vars')
}

const PASSWORD = 'WorkerClaim123!'
const RUN_ID = ulid().toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const newId = (prefix: string) => `${prefix}${ulid()}`
const token64 = () => randomBytes(32).toString('hex')

// ── Fixtures ───────────────────────────────────────────────────────────────────

// Shared company for RPC tests (tests 1-4)
let rpcCompanyId: string
// Client Admin RLS fixtures (tests 5-6)
let clientOrgId: string
let linkedCompanyId: string
let clientAdminId: string
let unrelatedOrgId: string
let unrelatedClientAdminId: string

// User JWT clients
let clientAdminClient: SupabaseClient      // linked org's client_admin
let unrelatedAdminClient: SupabaseClient   // unrelated org's client_admin

async function createAuthUser(label: string, meta: Record<string, string>) {
  const email = `worker-claim-${label}-${RUN_ID}@example.com`
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

describe('Worker invite claim — RPC and RLS', () => {
  before(async () => {
    // ── RPC test fixtures ────────────────────────────────────────────────────
    rpcCompanyId = newId('cco_')
    const { error: coErr } = await admin.from('contractor_companies').insert({
      id: rpcCompanyId,
      legal_name: 'Claim Test Co',
    })
    if (coErr) throw new Error(`rpc company: ${coErr.message}`)

    // ── Client Admin RLS fixtures ─────────────────────────────────────────────
    // Client org + client_admin
    clientOrgId = newId('org_')
    const { error: orgErr } = await admin.from('organizations').insert({
      id: clientOrgId,
      name: 'Claim Test Org',
    })
    if (orgErr) throw new Error(`org: ${orgErr.message}`)

    const clientAdmin = await createAuthUser('ca', { given_name: 'Client', family_name: 'Admin' })
    clientAdminId = clientAdmin.id
    const { error: caMemErr } = await admin.from('org_memberships').insert({
      id: newId('mem_'),
      user_id: clientAdminId,
      org_id: clientOrgId,
      roles: ['client_admin'],
      status: 'active',
    })
    if (caMemErr) throw new Error(`client_admin membership: ${caMemErr.message}`)

    // Linked contractor company + client_company_link (active)
    linkedCompanyId = newId('cco_')
    const { error: lcErr } = await admin.from('contractor_companies').insert({
      id: linkedCompanyId,
      legal_name: 'Linked Contractor Co',
    })
    if (lcErr) throw new Error(`linked company: ${lcErr.message}`)

    const { error: linkErr } = await admin.from('client_company_links').insert({
      id: newId('lnk_'),
      org_id: clientOrgId,
      company_id: linkedCompanyId,
      status: 'active',
    })
    if (linkErr) throw new Error(`link: ${linkErr.message}`)

    // Worker in the linked company
    const worker = await createAuthUser('worker', { given_name: 'Worker', family_name: 'One' })
    const { error: wMemErr } = await admin.from('company_memberships').insert({
      id: newId('mem_'),
      user_id: worker.id,
      company_id: linkedCompanyId,
      roles: ['worker'],
      onboarding_status: 'invited',
      invited_email: worker.email,
      status: 'active',
    })
    if (wMemErr) throw new Error(`worker membership: ${wMemErr.message}`)

    // Unrelated org + client_admin (no link to linkedCompanyId)
    unrelatedOrgId = newId('org_')
    const { error: unorgErr } = await admin.from('organizations').insert({
      id: unrelatedOrgId,
      name: 'Unrelated Org',
    })
    if (unorgErr) throw new Error(`unrelated org: ${unorgErr.message}`)

    const unrelatedAdmin = await createAuthUser('unrelated', {
      given_name: 'Unrelated',
      family_name: 'Admin',
    })
    unrelatedClientAdminId = unrelatedAdmin.id
    const { error: unMemErr } = await admin.from('org_memberships').insert({
      id: newId('mem_'),
      user_id: unrelatedClientAdminId,
      org_id: unrelatedOrgId,
      roles: ['client_admin'],
      status: 'active',
    })
    if (unMemErr) throw new Error(`unrelated membership: ${unMemErr.message}`)

    // Sign in both client admins
    clientAdminClient = await signIn(clientAdmin.email)
    unrelatedAdminClient = await signIn(unrelatedAdmin.email)
  })

  after(async () => {
    // Clean up in FK order: memberships, invitations, links, companies, org memberships, orgs
    await admin.from('invitations').delete().in('company_id', [rpcCompanyId, linkedCompanyId])
    await admin.from('company_memberships').delete().in('company_id', [rpcCompanyId, linkedCompanyId])
    await admin.from('client_company_links').delete().eq('company_id', linkedCompanyId)
    await admin.from('contractor_companies').delete().in('id', [rpcCompanyId, linkedCompanyId])
    await admin.from('org_memberships').delete().in('org_id', [clientOrgId, unrelatedOrgId])
    await admin.from('organizations').delete().in('id', [clientOrgId, unrelatedOrgId])

    const runEmails = [
      `worker-claim-ca-${RUN_ID}@example.com`,
      `worker-claim-worker-${RUN_ID}@example.com`,
      `worker-claim-unrelated-${RUN_ID}@example.com`,
    ]
    const { data: all } = await admin.auth.admin.listUsers()
    const toDelete = all.users.filter((u) => runEmails.includes(u.email ?? '')).map((u) => u.id)
    for (const id of toDelete) await admin.auth.admin.deleteUser(id)
  })

  // ── RPC tests ──────────────────────────────────────────────────────────────

  it('valid claim: RPC advances onboarding_status to account_created and consumes the invitation', async () => {
    // Provision a provisional user + membership + invitation for this test.
    const provisionalEmail = `worker-claim-prov1-${RUN_ID}@example.com`
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: provisionalEmail,
      email_confirm: true,
      user_metadata: { given_name: 'Prov', family_name: 'One' },
    })
    if (authErr || !authData.user) throw new Error(`create provisional: ${authErr?.message}`)
    const provId = authData.user.id

    const memId = newId('mem_')
    const { error: memErr } = await admin.from('company_memberships').insert({
      id: memId,
      user_id: provId,
      company_id: rpcCompanyId,
      roles: ['worker'],
      onboarding_status: 'invited',
      invited_email: provisionalEmail,
      status: 'active',
    })
    assert.ifError(memErr)

    const tok = token64()
    const { error: invErr } = await admin.from('invitations').insert({
      id: newId('inv_'),
      type: 'worker',
      token: tok,
      channel: 'email',
      email: provisionalEmail,
      company_id: rpcCompanyId,
      intended_roles: ['worker'],
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: provId,
    })
    assert.ifError(invErr)

    // Call the RPC (normal claim path).
    const { error: rpcErr } = await admin.rpc('claim_worker_invite', {
      p_token: tok,
      p_claiming_user_id: provId,
      p_provisional_user_id: provId,
    })
    assert.ifError(rpcErr)

    // Verify lifecycle advanced.
    const { data: mem } = await admin
      .from('company_memberships')
      .select('onboarding_status')
      .eq('id', memId)
      .single()
    assert.equal(mem?.onboarding_status, 'account_created')

    // Verify invitation consumed.
    const { data: inv } = await admin
      .from('invitations')
      .select('status, accepted_user_id')
      .eq('token', tok)
      .single()
    assert.equal(inv?.status, 'accepted')
    assert.equal(inv?.accepted_user_id, provId)

    // Cleanup
    await admin.from('invitations').delete().eq('token', tok)
    await admin.from('company_memberships').delete().eq('id', memId)
    await admin.auth.admin.deleteUser(provId)
  })

  it('expired token: RPC raises expired', async () => {
    const provisionalEmail = `worker-claim-exp-${RUN_ID}@example.com`
    const { data: expUserData } = await admin.auth.admin.createUser({
      email: provisionalEmail,
      email_confirm: true,
      user_metadata: { given_name: 'Exp', family_name: 'User' },
    })
    const expId = expUserData!.user!.id

    const tok = token64()
    await admin.from('company_memberships').insert({
      id: newId('mem_'),
      user_id: expId,
      company_id: rpcCompanyId,
      roles: ['worker'],
      onboarding_status: 'invited',
      invited_email: provisionalEmail,
      status: 'active',
    })
    await admin.from('invitations').insert({
      id: newId('inv_'),
      type: 'worker',
      token: tok,
      channel: 'email',
      email: provisionalEmail,
      company_id: rpcCompanyId,
      intended_roles: ['worker'],
      status: 'pending',
      expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
      created_by: expId,
    })

    const { error } = await admin.rpc('claim_worker_invite', {
      p_token: tok,
      p_claiming_user_id: expId,
      p_provisional_user_id: expId,
    })
    assert.ok(error, 'Expected RPC to fail for expired token')
    assert.match(error!.message, /expired/i)

    // Cleanup
    await admin.from('invitations').delete().eq('token', tok)
    await admin.from('company_memberships').delete().eq('user_id', expId)
    await admin.auth.admin.deleteUser(expId)
  })

  it('already-used token: RPC raises already_used', async () => {
    const provisionalEmail = `worker-claim-used-${RUN_ID}@example.com`
    const { data: usedUserData } = await admin.auth.admin.createUser({
      email: provisionalEmail,
      email_confirm: true,
      user_metadata: { given_name: 'Used', family_name: 'User' },
    })
    const usedId = usedUserData!.user!.id

    const tok = token64()
    await admin.from('company_memberships').insert({
      id: newId('mem_'),
      user_id: usedId,
      company_id: rpcCompanyId,
      roles: ['worker'],
      onboarding_status: 'invited',
      invited_email: provisionalEmail,
      status: 'active',
    })
    await admin.from('invitations').insert({
      id: newId('inv_'),
      type: 'worker',
      token: tok,
      channel: 'email',
      email: provisionalEmail,
      company_id: rpcCompanyId,
      intended_roles: ['worker'],
      status: 'accepted', // already consumed
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: usedId,
    })

    const { error } = await admin.rpc('claim_worker_invite', {
      p_token: tok,
      p_claiming_user_id: usedId,
      p_provisional_user_id: usedId,
    })
    assert.ok(error, 'Expected RPC to fail for already-used token')
    assert.match(error!.message, /already_used/i)

    // Cleanup
    await admin.from('invitations').delete().eq('token', tok)
    await admin.from('company_memberships').delete().eq('user_id', usedId)
    await admin.auth.admin.deleteUser(usedId)
  })

  it('soft-match merge: RPC re-points membership to existing user, provisional is discarded', async () => {
    // Set up: provisional user A (the invite stub) + existing user B (same person, different email).
    const provEmail = `worker-claim-prov-merge-${RUN_ID}@example.com`
    const existEmail = `worker-claim-exist-merge-${RUN_ID}@example.com`

    const { data: provData } = await admin.auth.admin.createUser({
      email: provEmail,
      email_confirm: true,
      user_metadata: { given_name: 'Merge', family_name: 'Person' },
    })
    const provId = provData!.user!.id

    const { data: existData } = await admin.auth.admin.createUser({
      email: existEmail,
      email_confirm: true,
      user_metadata: { given_name: 'Merge', family_name: 'Person' },
    })
    const existId = existData!.user!.id

    const memId = newId('mem_')
    await admin.from('company_memberships').insert({
      id: memId,
      user_id: provId,
      company_id: rpcCompanyId,
      roles: ['worker'],
      onboarding_status: 'invited',
      invited_email: provEmail,
      status: 'active',
    })

    const tok = token64()
    await admin.from('invitations').insert({
      id: newId('inv_'),
      type: 'worker',
      token: tok,
      channel: 'email',
      email: provEmail,
      company_id: rpcCompanyId,
      intended_roles: ['worker'],
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: provId,
    })

    // RPC merge path: claiming user = existId, provisional = provId.
    const { error: rpcErr } = await admin.rpc('claim_worker_invite', {
      p_token: tok,
      p_claiming_user_id: existId,
      p_provisional_user_id: provId,
    })
    assert.ifError(rpcErr)

    // Verify the membership now belongs to existId, not provId.
    const { data: mergedMem } = await admin
      .from('company_memberships')
      .select('user_id, onboarding_status')
      .eq('id', memId)
      .maybeSingle()
    assert.equal(mergedMem?.user_id, existId, 'Membership should be re-pointed to existing user')
    assert.equal(mergedMem?.onboarding_status, 'account_created')

    // Verify invitation consumed with the existing user as claimant.
    const { data: inv } = await admin
      .from('invitations')
      .select('status, accepted_user_id')
      .eq('token', tok)
      .single()
    assert.equal(inv?.status, 'accepted')
    assert.equal(inv?.accepted_user_id, existId)

    // Verify no duplicate membership for provId in this company.
    const { data: provMem } = await admin
      .from('company_memberships')
      .select('id')
      .eq('user_id', provId)
      .eq('company_id', rpcCompanyId)
      .maybeSingle()
    assert.ok(!provMem, 'Provisional membership should have been deleted')

    // Cleanup
    await admin.from('invitations').delete().eq('token', tok)
    await admin.from('company_memberships').delete().eq('id', memId)
    await admin.auth.admin.deleteUser(provId)
    await admin.auth.admin.deleteUser(existId)
  })

  // ── RLS tests (user-JWT clients) ──────────────────────────────────────────

  it('Client Admin (linked org) can read sliced worker memberships via user-JWT', async () => {
    const { data: memberships, error } = await clientAdminClient
      .from('company_memberships')
      .select('company_id, invited_email, onboarding_status')
      .eq('company_id', linkedCompanyId)
      .eq('status', 'active')
      .contains('roles', ['worker'])

    assert.ifError(error)
    assert.ok(Array.isArray(memberships), 'Expected an array')
    assert.ok((memberships?.length ?? 0) > 0, 'Linked Client Admin should see worker memberships')

    // Verify only the linked company's workers are returned.
    for (const m of memberships ?? []) {
      assert.equal(
        (m as { company_id: string }).company_id,
        linkedCompanyId,
        'Should only see workers for the linked company',
      )
    }
  })

  it('unrelated client cannot read worker memberships for an unlinked company', async () => {
    const { data: memberships, error } = await unrelatedAdminClient
      .from('company_memberships')
      .select('company_id, invited_email, onboarding_status')
      .eq('company_id', linkedCompanyId)
      .eq('status', 'active')
      .contains('roles', ['worker'])

    // RLS blocks all rows for unrelated clients — no error, just empty result.
    assert.ifError(error)
    assert.equal(
      (memberships ?? []).length,
      0,
      'Unrelated client should see zero worker memberships',
    )
  })
})
