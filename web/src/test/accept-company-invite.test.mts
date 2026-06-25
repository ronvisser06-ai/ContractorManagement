/**
 * M1 Step 3 — accept_company_invite RPC integration test.
 *
 * Seeded entirely with the admin client; RPC called via admin client
 * (mirrors the server action that passes p_user_id explicitly).
 * Tests:
 *  - Valid token: company updated, membership created, link activated, invite consumed
 *  - Re-use of the same token: rejected (already accepted)
 *  - Expired token: rejected
 *  - Non-existent token: rejected
 */

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const newId = (prefix: string) => `${prefix}${ulid()}`
const token64 = () => randomBytes(32).toString('hex')

// ─── Seed data shared across tests ───────────────────────────────────────────
let clientUserId: string
let orgId: string
let companyId: string
let pendingToken: string
let expiredToken: string
let registrantUserId: string

async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'TestPassword1!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  return data.user.id
}

async function deleteAuthUser(id: string) {
  await admin.auth.admin.deleteUser(id)
}

describe('accept_company_invite RPC', () => {
  before(async () => {
    // --- Client org + admin user ---
    clientUserId = await createAuthUser(`client-admin-invite-test-${ulid()}@example.com`)
    orgId = newId('org_')

    const { error: orgErr } = await admin.from('organizations').insert({
      id: orgId,
      name: 'Invite Test Client Org',
      status: 'active',
    })
    if (orgErr) throw new Error(`org insert: ${orgErr.message}`)

    const { error: orgMemErr } = await admin.from('org_memberships').insert({
      id: newId('omem_'),
      user_id: clientUserId,
      org_id: orgId,
      roles: ['client_admin'],
      status: 'active',
    })
    if (orgMemErr) throw new Error(`org_membership insert: ${orgMemErr.message}`)

    // --- Stub contractor company (status=active; 'invited' state lives on the link) ---
    companyId = newId('cco_')
    const { error: ccErr } = await admin.from('contractor_companies').insert({
      id: companyId,
      legal_name: 'Invited: invitee@example.com',
      contact_email: 'invitee@example.com',
    })
    if (ccErr) throw new Error(`contractor_companies insert: ${ccErr.message}`)

    // --- client_company_link (invited — invited_at defaults to NOW()) ---
    const { error: linkErr } = await admin.from('client_company_links').insert({
      id: newId('ccl_'),
      org_id: orgId,
      company_id: companyId,
      status: 'invited',
    })
    if (linkErr) throw new Error(`client_company_links insert: ${linkErr.message}`)

    // --- Pending invitation ---
    pendingToken = token64()
    const { error: invErr } = await admin.from('invitations').insert({
      id: newId('inv_'),
      org_id: orgId,
      company_id: companyId,
      token: pendingToken,
      type: 'company',
      channel: 'email',
      email: 'invitee@example.com',
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: clientUserId,
    })
    if (invErr) throw new Error(`invitations insert: ${invErr.message}`)

    // --- Expired invitation (separate stub company for isolation) ---
    expiredToken = token64()
    const expiredCompanyId = newId('cco_')
    await admin.from('contractor_companies').insert({
      id: expiredCompanyId,
      legal_name: 'Invited: expired@example.com',
      contact_email: 'expired@example.com',
    })
    await admin.from('invitations').insert({
      id: newId('inv_'),
      org_id: orgId,
      company_id: expiredCompanyId,
      token: expiredToken,
      type: 'company',
      channel: 'email',
      email: 'expired@example.com',
      status: 'pending',
      expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
      created_by: clientUserId,
    })

    // --- Registrant auth user (simulates Supabase signUp + handle_new_user trigger) ---
    registrantUserId = await createAuthUser(`contractor-admin-${ulid()}@example.com`)
  })

  after(async () => {
    // Clean up — order matters to respect FKs
    await admin.from('invitations').delete().in('token', [pendingToken, expiredToken])
    await admin.from('company_memberships').delete().eq('user_id', registrantUserId)
    await admin.from('client_company_links').delete().eq('company_id', companyId)
    await admin
      .from('contractor_companies')
      .delete()
      .like('contact_email', '%@example.com')
    await admin.from('org_memberships').delete().eq('user_id', clientUserId)
    await admin.from('organizations').delete().eq('id', orgId)
    await deleteAuthUser(clientUserId)
    await deleteAuthUser(registrantUserId)
  })

  it('rejects an invalid token', async () => {
    const { error } = await admin.rpc('accept_company_invite', {
      p_token: token64(),
      p_user_id: registrantUserId,
      p_membership_id: newId('mem_'),
      p_legal_name: 'Acme',
    })
    assert.ok(error, 'Expected RPC to fail for unknown token')
    assert.match(error.message, /invalid invitation token/i)
  })

  it('rejects an expired token', async () => {
    const { error } = await admin.rpc('accept_company_invite', {
      p_token: expiredToken,
      p_user_id: registrantUserId,
      p_membership_id: newId('mem_'),
      p_legal_name: 'Acme',
    })
    assert.ok(error, 'Expected RPC to fail for expired token')
    assert.match(error.message, /expired/i)
  })

  it('rejects an empty legal name', async () => {
    const { error } = await admin.rpc('accept_company_invite', {
      p_token: pendingToken,
      p_user_id: registrantUserId,
      p_membership_id: newId('mem_'),
      p_legal_name: '   ',
    })
    assert.ok(error, 'Expected RPC to fail for blank legal name')
    assert.match(error.message, /cannot be empty/i)
  })

  it('accepts a valid token: updates company, creates membership, activates link', async () => {
    const membershipId = newId('mem_')
    const { data, error } = await admin.rpc('accept_company_invite', {
      p_token: pendingToken,
      p_user_id: registrantUserId,
      p_membership_id: membershipId,
      p_legal_name: '  Acme Contracting Ltd.  ',
    })
    assert.ifError(error)
    assert.equal(data, companyId)

    // Company legal_name updated (trimmed)
    const { data: cc } = await admin
      .from('contractor_companies')
      .select('legal_name, status')
      .eq('id', companyId)
      .single()
    assert.equal(cc?.legal_name, 'Acme Contracting Ltd.')

    // Membership created with contractor_admin role
    const { data: mem } = await admin
      .from('company_memberships')
      .select('id, roles, status, onboarding_status')
      .eq('user_id', registrantUserId)
      .eq('company_id', companyId)
      .single()
    assert.ok(mem, 'Membership row should exist')
    assert.deepEqual(mem?.roles, ['contractor_admin'])
    assert.equal(mem?.status, 'active')
    assert.equal(mem?.onboarding_status, 'account_created')

    // client_company_link flipped to active
    const { data: link } = await admin
      .from('client_company_links')
      .select('status, accepted_at')
      .eq('org_id', orgId)
      .eq('company_id', companyId)
      .single()
    assert.equal(link?.status, 'active')
    assert.ok(link?.accepted_at, 'accepted_at should be set')

    // Invitation marked accepted
    const { data: inv } = await admin
      .from('invitations')
      .select('status, accepted_user_id, accepted_at')
      .eq('token', pendingToken)
      .single()
    assert.equal(inv?.status, 'accepted')
    assert.equal(inv?.accepted_user_id, registrantUserId)
    assert.ok(inv?.accepted_at)
  })

  it('rejects re-use of the same token', async () => {
    const { error } = await admin.rpc('accept_company_invite', {
      p_token: pendingToken,
      p_user_id: registrantUserId,
      p_membership_id: newId('mem_'),
      p_legal_name: 'Acme',
    })
    assert.ok(error, 'Expected RPC to fail for already-accepted token')
    assert.match(error.message, /already been used/i)
  })
})
