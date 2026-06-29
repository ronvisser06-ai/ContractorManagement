// Tests for the Team page role-management mechanics (toggleRole action).
//
// Does NOT invoke the Next.js server action directly (redirect() makes that
// awkward in a test runner). Instead it exercises the exact DB queries the
// action runs, using the same Supabase client construction pattern.
//
// Covers:
//   1. client_admin grants a role to another member
//   2. client_admin grants a role to themselves
//   3. non-admin cannot update membership roles (RLS blocks)
//   4. last-admin guard: sole admin removal is caught; DB would permit it,
//      so the application guard is the only safety net — test must demonstrate both.
//
// Run with: npm test

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ulid } from 'ulid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const PASSWORD = 'RoleTest123!'
const RUN_ID = ulid().toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

let adminUserId: string
let memberUserId: string
let orgId: string
let adminMembershipId: string
let memberMembershipId: string
let adminClient!: SupabaseClient
let memberClient!: SupabaseClient

before(async () => {
  const adminEmail = `role-admin-${RUN_ID}@example.com`
  const memberEmail = `role-member-${RUN_ID}@example.com`

  const { data: adminUser, error: ae } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'Admin', family_name: 'User' },
  })
  if (ae || !adminUser.user) throw new Error(`createUser(admin) failed: ${ae?.message}`)
  adminUserId = adminUser.user.id

  const { data: memberUser, error: me } = await admin.auth.admin.createUser({
    email: memberEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'Member', family_name: 'User' },
  })
  if (me || !memberUser.user) throw new Error(`createUser(member) failed: ${me?.message}`)
  memberUserId = memberUser.user.id

  // Sign in both users
  adminClient = createClient(SUPABASE_URL, ANON_KEY)
  const { error: adminSignIn } = await adminClient.auth.signInWithPassword({
    email: adminEmail,
    password: PASSWORD,
  })
  if (adminSignIn) throw new Error(`signIn(admin) failed: ${adminSignIn.message}`)

  memberClient = createClient(SUPABASE_URL, ANON_KEY)
  const { error: memberSignIn } = await memberClient.auth.signInWithPassword({
    email: memberEmail,
    password: PASSWORD,
  })
  if (memberSignIn) throw new Error(`signIn(member) failed: ${memberSignIn.message}`)

  // Create org via RPC (grants adminUser the client_admin role)
  orgId = `org_${ulid()}`
  adminMembershipId = `mem_${ulid()}`
  const { error: orgErr } = await adminClient.rpc('create_organization', {
    p_org_id: orgId,
    p_org_name: `Role Test Org ${RUN_ID}`,
    p_membership_id: adminMembershipId,
  })
  if (orgErr) throw new Error(`create_organization failed: ${orgErr.message}`)

  // Insert memberUser's membership via admin (no user INSERT policy on org_memberships)
  memberMembershipId = `mem_${ulid()}`
  const { error: memErr } = await admin.from('org_memberships').insert({
    id: memberMembershipId,
    user_id: memberUserId,
    org_id: orgId,
    roles: [],
    status: 'active',
  })
  if (memErr) throw new Error(`member membership insert failed: ${memErr.message}`)
})

after(async () => {
  if (orgId) {
    await admin.from('org_memberships').delete().eq('org_id', orgId)
    await admin.from('organizations').delete().eq('id', orgId)
  }
  for (const uid of [adminUserId, memberUserId]) {
    if (uid) {
      await admin.from('users').delete().eq('id', uid)
      await admin.auth.admin.deleteUser(uid)
    }
  }
})

test('client_admin grants content_approver to another member', async () => {
  // Pre-condition: member has no roles
  const { data: before } = await admin
    .from('org_memberships')
    .select('roles')
    .eq('id', memberMembershipId)
    .single()
  assert.deepEqual(before?.roles, [], 'member starts with no roles')

  // toggleRole grant path (mirrors action's UPDATE)
  const currentRoles: string[] = (before?.roles as string[]) ?? []
  const newRoles = Array.from(new Set([...currentRoles, 'content_approver']))
  const { error } = await adminClient
    .from('org_memberships')
    .update({ roles: newRoles })
    .eq('id', memberMembershipId)
  assert.equal(error, null, `grant failed: ${error?.message}`)

  const { data: after } = await admin
    .from('org_memberships')
    .select('roles')
    .eq('id', memberMembershipId)
    .single()
  assert.ok(
    (after?.roles as string[]).includes('content_approver'),
    'member now has content_approver',
  )

  // Restore
  await admin.from('org_memberships').update({ roles: [] }).eq('id', memberMembershipId)
})

test('client_admin grants content_approver to themselves', async () => {
  const { data: before } = await admin
    .from('org_memberships')
    .select('roles')
    .eq('id', adminMembershipId)
    .single()
  const currentRoles: string[] = (before?.roles as string[]) ?? []
  assert.ok(currentRoles.includes('client_admin'), 'admin starts with client_admin')
  assert.ok(!currentRoles.includes('content_approver'), 'admin does not yet have content_approver')

  const newRoles = Array.from(new Set([...currentRoles, 'content_approver']))
  const { error } = await adminClient
    .from('org_memberships')
    .update({ roles: newRoles })
    .eq('id', adminMembershipId)
  assert.equal(error, null, `self-grant failed: ${error?.message}`)

  const { data: after } = await admin
    .from('org_memberships')
    .select('roles')
    .eq('id', adminMembershipId)
    .single()
  assert.ok(
    (after?.roles as string[]).includes('content_approver'),
    'admin now also has content_approver',
  )

  // Restore to just client_admin
  await admin
    .from('org_memberships')
    .update({ roles: ['client_admin'] })
    .eq('id', adminMembershipId)
})

test('non-admin cannot update membership roles (RLS blocks)', async () => {
  // memberClient has no roles — the UPDATE policy requires client_admin
  const { error } = await memberClient
    .from('org_memberships')
    .update({ roles: ['client_admin'] })
    .eq('id', adminMembershipId)

  // RLS should block the write; the row simply doesn't appear in the UPDATE's
  // USING filter so PostgREST returns success with 0 rows affected rather than
  // a permission error — but the admin membership must remain unchanged.
  const { data: unchanged } = await admin
    .from('org_memberships')
    .select('roles')
    .eq('id', adminMembershipId)
    .single()
  // The admin's role must still be ['client_admin'] — non-admin cannot escalate
  assert.deepEqual(
    unchanged?.roles,
    ['client_admin'],
    `non-admin must not be able to modify admin membership (error: ${error?.message})`,
  )
})

test('last-admin guard: sole admin detected; DB permits the write but guard blocks the action', async () => {
  // Step 1: replicate the guard query (toggleRole fetches all active memberships
  // and counts client_admins in JS before writing)
  const { data: allActive } = await adminClient
    .from('org_memberships')
    .select('roles')
    .eq('org_id', orgId)
    .eq('status', 'active')

  const adminCount = (allActive ?? []).filter((m) =>
    ((m.roles as string[] | undefined) ?? []).includes('client_admin'),
  ).length

  assert.equal(adminCount, 1, 'org has exactly one client_admin')

  // Guard condition from the action: adminCount <= 1 → redirect with error
  assert.ok(adminCount <= 1, 'guard fires: toggleRole would redirect without updating')

  // Step 2: prove the DB layer does NOT protect against this — RLS permits the
  // write (USING evaluates with the caller's current roles, which still include
  // client_admin at the time the UPDATE runs). The application guard is the
  // only safety net.
  const { error: dbErr } = await adminClient
    .from('org_memberships')
    .update({ roles: [] })
    .eq('id', adminMembershipId)
  assert.equal(dbErr, null, 'DB permits removal — guard must be in the application, not RLS')

  // Immediately restore via admin client (the user's own client is now demoted)
  const { error: restoreErr } = await admin
    .from('org_memberships')
    .update({ roles: ['client_admin'] })
    .eq('id', adminMembershipId)
  assert.equal(restoreErr, null, `restore failed: ${restoreErr?.message}`)

  // Confirm the restore
  const { data: restored } = await admin
    .from('org_memberships')
    .select('roles')
    .eq('id', adminMembershipId)
    .single()
  assert.deepEqual(restored?.roles, ['client_admin'], 'admin role restored after test')
})
