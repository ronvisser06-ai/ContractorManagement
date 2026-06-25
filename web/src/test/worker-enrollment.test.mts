/**
 * M1 Step 4a — Worker enrollment RLS integration test.
 *
 * Tests the RLS layer that backs the worker roster:
 *  - contractor_admin can INSERT a worker membership for their company
 *  - contractor_admin can UPDATE a membership (advance onboarding_status)
 *  - contractor_admin can INSERT a worker invitation for their company
 *  - contractor_admin can read other company members' users rows (migration 0009 policy)
 *  - a plain worker (no contractor_admin role) cannot INSERT a membership
 *  - a plain worker cannot INSERT an invitation
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

const PASSWORD = 'WorkerEnroll123!'
const RUN_ID = ulid().toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const newId = (prefix: string) => `${prefix}${ulid()}`
const token64 = () => randomBytes(32).toString('hex')

// ── Fixture state ─────────────────────────────────────────────────────────────

let companyId: string
let contractorAdminId: string
let workerUserId: string          // provisional worker created by admin
let workerMembershipId: string

let adminClient: SupabaseClient   // signed-in as contractor_admin
let workerClient: SupabaseClient  // signed-in as the (entered) worker

async function createAuthUser(label: string, meta: Record<string, string>) {
  const email = `worker-enroll-${label}-${RUN_ID}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: meta,
  })
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`)
  return data.user.id
}

async function signIn(label: string): Promise<SupabaseClient> {
  const email = `worker-enroll-${label}-${RUN_ID}@example.com`
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`signIn(${label}): ${error.message}`)
  return client
}

describe('Worker enrollment RLS', () => {
  before(async () => {
    // 1. Contractor company
    companyId = newId('cco_')
    const { error: coErr } = await admin.from('contractor_companies').insert({
      id: companyId,
      legal_name: 'Worker Enroll Test Co',
    })
    if (coErr) throw new Error(`contractor_companies insert: ${coErr.message}`)

    // 2. Contractor admin user + membership
    contractorAdminId = await createAuthUser('admin', { given_name: 'Admin', family_name: 'User' })
    const adminMemId = newId('mem_')
    const { error: adminMemErr } = await admin.from('company_memberships').insert({
      id: adminMemId,
      user_id: contractorAdminId,
      company_id: companyId,
      roles: ['contractor_admin'],
      onboarding_status: 'account_created',
      status: 'active',
    })
    if (adminMemErr) throw new Error(`admin membership insert: ${adminMemErr.message}`)

    // 3. Provisional worker user (created by admin — no password initially, but for test
    //    we give them one so we can sign in as them to test RLS blocking)
    workerUserId = await createAuthUser('worker', { given_name: 'Worker', family_name: 'User' })

    // 4. Sign in both actors
    adminClient = await signIn('admin')
    workerClient = await signIn('worker')
  })

  after(async () => {
    // Clean up in FK order
    await admin.from('invitations').delete().eq('company_id', companyId)
    await admin.from('company_memberships').delete().eq('company_id', companyId)
    await admin.from('contractor_companies').delete().eq('id', companyId)
    const adminEmail = `worker-enroll-admin-${RUN_ID}@example.com`
    const workerEmail = `worker-enroll-worker-${RUN_ID}@example.com`
    const { data: adminAuthUser } = await admin.auth.admin.listUsers()
    const toDelete = adminAuthUser.users
      .filter((u) => u.email === adminEmail || u.email === workerEmail)
      .map((u) => u.id)
    for (const id of toDelete) await admin.auth.admin.deleteUser(id)
  })

  it('contractor_admin can read the worker user profile via the new RLS policy', async () => {
    // Migration 0009 added "users: company member reads" — verify it works.
    // First insert a worker membership so the admin and worker share a company.
    workerMembershipId = newId('mem_')
    const { error: memErr } = await admin.from('company_memberships').insert({
      id: workerMembershipId,
      user_id: workerUserId,
      company_id: companyId,
      roles: ['worker'],
      onboarding_status: 'entered',
      invited_email: `worker-enroll-worker-${RUN_ID}@example.com`,
      status: 'active',
    })
    assert.ifError(memErr)

    // Admin JWT should now be able to read the worker's users row.
    const { data: workerProfile, error: readErr } = await adminClient
      .from('users')
      .select('id, given_name, family_name')
      .eq('id', workerUserId)
      .maybeSingle()

    assert.ifError(readErr)
    assert.ok(workerProfile, 'Admin should be able to read worker profile via company membership RLS')
    assert.equal(workerProfile.given_name, 'Worker')
  })

  it('contractor_admin can INSERT a worker membership via user client (RLS)', async () => {
    const newMemberId = newId('mem_')
    // Create another provisional user to enroll
    const anotherEmail = `worker-enroll-extra-${RUN_ID}@example.com`
    const { data: extraUser, error: extraErr } = await admin.auth.admin.createUser({
      email: anotherEmail,
      email_confirm: true,
      user_metadata: { given_name: 'Extra', family_name: 'Worker' },
    })
    if (extraErr || !extraUser?.user) throw new Error(`createUser extra: ${extraErr?.message}`)
    const extraUserId = extraUser.user.id

    const { error } = await adminClient.from('company_memberships').insert({
      id: newMemberId,
      user_id: extraUserId,
      company_id: companyId,
      roles: ['worker'],
      onboarding_status: 'entered',
      invited_email: anotherEmail,
      status: 'active',
    })
    assert.ifError(error)

    // Verify it was created
    const { data: created } = await admin
      .from('company_memberships')
      .select('onboarding_status, roles')
      .eq('id', newMemberId)
      .single()
    assert.equal(created?.onboarding_status, 'entered')
    assert.deepEqual(created?.roles, ['worker'])

    // Clean up extra user
    await admin.from('company_memberships').delete().eq('id', newMemberId)
    await admin.auth.admin.deleteUser(extraUserId)
  })

  it('contractor_admin can UPDATE membership onboarding_status (RLS)', async () => {
    const { error } = await adminClient
      .from('company_memberships')
      .update({ onboarding_status: 'invited' })
      .eq('id', workerMembershipId)
      .eq('company_id', companyId)

    assert.ifError(error)

    const { data: updated } = await admin
      .from('company_memberships')
      .select('onboarding_status')
      .eq('id', workerMembershipId)
      .single()
    assert.equal(updated?.onboarding_status, 'invited')
  })

  it('contractor_admin can INSERT a worker invitation (RLS)', async () => {
    const workerEmail = `worker-enroll-worker-${RUN_ID}@example.com`
    const { error } = await adminClient.from('invitations').insert({
      id: newId('inv_'),
      type: 'worker',
      token: token64(),
      channel: 'email',
      email: workerEmail,
      company_id: companyId,
      intended_roles: ['worker'],
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: contractorAdminId,
    })
    assert.ifError(error)
  })

  it('plain worker cannot INSERT a company_membership (RLS blocks)', async () => {
    // workerClient is signed in as the worker (role=worker, NOT contractor_admin)
    const { error } = await workerClient.from('company_memberships').insert({
      id: newId('mem_'),
      user_id: workerUserId,
      company_id: companyId,
      roles: ['worker'],
      onboarding_status: 'entered',
      status: 'active',
    })
    assert.ok(error, 'Expected INSERT to fail for non-admin worker')
  })

  it('plain worker cannot INSERT an invitation for the company (RLS blocks)', async () => {
    const { error } = await workerClient.from('invitations').insert({
      id: newId('inv_'),
      type: 'worker',
      token: token64(),
      channel: 'email',
      email: 'some@example.com',
      company_id: companyId,
      intended_roles: ['worker'],
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: workerUserId,
    })
    assert.ok(error, 'Expected INSERT to fail for non-admin worker')
  })
})
