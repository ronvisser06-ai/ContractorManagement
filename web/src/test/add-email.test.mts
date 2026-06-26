/**
 * M1 Step 6 — Add-email self-service + identity consolidation.
 *
 * Tests exercise user-JWT Supabase clients and the verify_and_link_email() RPC.
 *
 * Test matrix:
 *  1. Add + verify a new email → appears in user_emails with verified_at set
 *  2. Pending company_membership whose invited_email matches → linked to the verifying
 *     identity (user_id re-pointed, onboarding_status = account_created)
 *  3. Email already verified to a different user → RPC raises email_taken
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

const PASSWORD = 'AddEmail123!'
const RUN_ID = ulid().toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const newId = (prefix: string) => `${prefix}${ulid()}`

async function createAuthUser(label: string, meta: Record<string, string>) {
  const email = `step6-${label}-${RUN_ID}@example.com`
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

function futureTs(hours = 24) {
  return new Date(Date.now() + hours * 3600_000).toISOString()
}

// ── Fixture state ──────────────────────────────────────────────────────────────
let user1Id: string
let user2Id: string
let provisionalUserId: string
let company1Id: string
let authUserIds: string[] = []

let user1Client: SupabaseClient

// Token names are deterministic per run so cleanup is safe.
const tok1 = `tok1-${RUN_ID}` // test 1: plain add + verify
const tok2 = `tok2-${RUN_ID}` // test 2: invite linking
const tok3 = `tok3-${RUN_ID}` // test 3: email_taken
const email1 = `new-email-${RUN_ID}@example.com`
const emailInvite = `invite-target-${RUN_ID}@example.com`
const emailTaken = `taken-${RUN_ID}@example.com`

describe('Add-email self-service — Step 6', () => {
  before(async () => {
    // ── Auth users ─────────────────────────────────────────────────────────
    const user1 = await createAuthUser('u1', { given_name: 'Alice', family_name: 'Tester' })
    const user2 = await createAuthUser('u2', { given_name: 'Bob', family_name: 'Tester' })
    user1Id = user1.id
    user2Id = user2.id
    authUserIds = [user1.id, user2.id]

    // ── Company (needed for test 2) ────────────────────────────────────────
    company1Id = newId('cco_')
    const { error: coErr } = await admin
      .from('contractor_companies')
      .insert({ id: company1Id, legal_name: 'Step6 Company' })
    if (coErr) throw new Error(`company: ${coErr.message}`)

    // ── Provisional user — stub in public.users only (no auth account) ────
    // Simulates a worker who was entered/invited but has not yet registered.
    // public.users has no FK to auth.users, so this is fine.
    provisionalUserId = crypto.randomUUID()
    const { error: puErr } = await admin.from('users').insert({
      id: provisionalUserId,
      given_name: 'Provisional',
      family_name: 'Worker',
      primary_email: `provisional-${RUN_ID}@example.com`,
      status: 'active',
    })
    if (puErr) throw new Error(`provisional user: ${puErr.message}`)

    // ── company_membership for the provisional user (test 2) ──────────────
    // invited_email = emailInvite; onboarding_status = 'invited'
    const { error: memErr } = await admin.from('company_memberships').insert({
      id: newId('mem_'),
      user_id: provisionalUserId,
      company_id: company1Id,
      roles: ['worker'],
      onboarding_status: 'invited',
      invited_email: emailInvite,
      status: 'active',
    })
    if (memErr) throw new Error(`provisional membership: ${memErr.message}`)

    // ── user_emails for user2 (test 3 — email_taken) ──────────────────────
    const { error: ueErr } = await admin.from('user_emails').insert({
      id: newId('ueml_'),
      user_id: user2Id,
      email: emailTaken,
      is_primary: false,
      verified_at: new Date().toISOString(),
    })
    if (ueErr) throw new Error(`user_emails (taken): ${ueErr.message}`)

    // ── Sign in ────────────────────────────────────────────────────────────
    user1Client = await signIn(user1.email)
  })

  after(async () => {
    // Clean up in FK order.
    await admin.from('email_verifications').delete().in('token', [tok1, tok2, tok3])
    await admin.from('user_emails').delete().in('user_id', [user1Id, user2Id])
    await admin.from('company_memberships').delete().eq('company_id', company1Id)
    await admin.from('contractor_companies').delete().eq('id', company1Id)
    await admin.from('users').delete().eq('id', provisionalUserId)
    for (const uid of authUserIds) await admin.auth.admin.deleteUser(uid)
  })

  // ── Test 1: add + verify a new email ──────────────────────────────────────

  it('add + verify a new email → appears in user_emails with verified_at set', async () => {
    // User1 inserts a verification request (exercising the "insert own" RLS policy).
    const { error: insertErr } = await user1Client.from('email_verifications').insert({
      id: newId('evf_'),
      user_id: user1Id,
      email: email1,
      token: tok1,
      status: 'pending',
      expires_at: futureTs(),
    })
    assert.strictEqual(insertErr, null, `email_verifications insert: ${insertErr?.message}`)

    // Call the RPC.
    const { data, error: rpcErr } = await user1Client.rpc('verify_and_link_email', {
      p_token: tok1,
    })
    assert.strictEqual(rpcErr, null, `RPC error: ${rpcErr?.message}`)
    assert.ok(data !== null, 'Expected non-null RPC result')

    const result = data as { email: string; linked_companies: string[] }
    assert.strictEqual(result.email, email1, `Expected email=${email1}; got ${result.email}`)

    // Verify user_emails row was created (readable via "read own or company admin" policy).
    const { data: rows } = await user1Client
      .from('user_emails')
      .select('email, verified_at')
      .eq('user_id', user1Id)
      .eq('email', email1)
      .maybeSingle()

    assert.ok(rows !== null, 'Expected user_emails row to exist for email1')
    const row = rows as { email: string; verified_at: string | null }
    assert.ok(row.verified_at !== null, 'Expected verified_at to be set')
  })

  // ── Test 2: pending invite targeting the email links to the identity ───────

  it('pending company_membership with matching invited_email is linked to the verifying user', async () => {
    // User1 inserts a verification request for emailInvite.
    const { error: insertErr } = await user1Client.from('email_verifications').insert({
      id: newId('evf_'),
      user_id: user1Id,
      email: emailInvite,
      token: tok2,
      status: 'pending',
      expires_at: futureTs(),
    })
    assert.strictEqual(insertErr, null, `email_verifications insert: ${insertErr?.message}`)

    // Call the RPC — should find the provisional membership and re-point it.
    const { data, error: rpcErr } = await user1Client.rpc('verify_and_link_email', {
      p_token: tok2,
    })
    assert.strictEqual(rpcErr, null, `RPC error: ${rpcErr?.message}`)

    const result = data as { email: string; linked_companies: string[] }
    assert.ok(
      result.linked_companies.includes(company1Id),
      `Expected company1 in linked_companies; got ${JSON.stringify(result.linked_companies)}`,
    )

    // Verify via admin that the membership was re-pointed to user1.
    const { data: mem } = await admin
      .from('company_memberships')
      .select('user_id, onboarding_status')
      .eq('company_id', company1Id)
      .eq('invited_email', emailInvite)
      .maybeSingle()

    assert.ok(mem !== null, 'Expected membership to still exist')
    const m = mem as { user_id: string; onboarding_status: string }
    assert.strictEqual(m.user_id, user1Id, `Expected user_id=user1; got ${m.user_id}`)
    assert.strictEqual(
      m.onboarding_status,
      'account_created',
      `Expected onboarding_status=account_created; got ${m.onboarding_status}`,
    )
  })

  // ── Test 3: email already verified to another user → email_taken ──────────

  it('email already verified to another user is rejected with email_taken', async () => {
    // User1 inserts a verification request for emailTaken (already belongs to user2).
    const { error: insertErr } = await user1Client.from('email_verifications').insert({
      id: newId('evf_'),
      user_id: user1Id,
      email: emailTaken,
      token: tok3,
      status: 'pending',
      expires_at: futureTs(),
    })
    assert.strictEqual(insertErr, null, `email_verifications insert: ${insertErr?.message}`)

    // Call the RPC — should fail with email_taken.
    const { error: rpcErr } = await user1Client.rpc('verify_and_link_email', {
      p_token: tok3,
    })
    assert.ok(rpcErr !== null, 'Expected RPC to return an error for taken email')
    assert.ok(
      rpcErr.message.includes('email_taken'),
      `Expected error message to contain 'email_taken'; got: ${rpcErr.message}`,
    )
  })
})
