// Regression net (CLAUDE.md §7) for orientation_packages — same pattern as
// generation-jobs-isolation.test.mts. Proves RLS, not app code, stops one org
// from reading or writing another org's published packages. Run with `npm test`.
//
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local via `node --env-file`).
// Talks to the real Supabase project configured in .env.local — it seeds two
// throwaway users/orgs/sites/packages via the admin API and deletes them
// afterward. content_approver isn't grantable through the app yet (no invite
// flow until M1), so it's granted directly via the service role, same gap
// flagged for content_developer in Step 2.

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ulid } from 'ulid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const PASSWORD = 'IsolationTest123!'
const RUN_ID = ulid().toLowerCase()

interface Tenant {
  userId: string
  client: SupabaseClient
  orgId: string
  siteId: string
  packageId: string
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

let tenantA!: Tenant
let tenantB!: Tenant

function packageRow(id: string, orgId: string, siteId: string, approvedBy: string) {
  const now = new Date().toISOString()
  return {
    id,
    org_id: orgId,
    site_id: siteId,
    version: 1,
    content_model_ref: { storage_key: `sites/${siteId}/artifacts/content_model.json`, sha256: 'a'.repeat(64) },
    quiz_ref: { storage_key: `sites/${siteId}/artifacts/quiz.json`, sha256: 'b'.repeat(64) },
    content_hash: `sha256:${'c'.repeat(64)}`,
    requalification_policy: 'new_content_only' as const,
    approved_by: approvedBy,
    approved_at: now,
    published_at: now,
  }
}

async function provisionTenant(label: 'a' | 'b'): Promise<Tenant> {
  const email = `pkg-isolation-test-${label}-${RUN_ID}@example.com`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'PkgIsolation', family_name: label.toUpperCase() },
  })
  if (createErr || !created.user) {
    throw new Error(`createUser failed for ${email}: ${createErr?.message}`)
  }

  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr) throw new Error(`signIn failed for ${email}: ${signInErr.message}`)

  const orgId = `org_${ulid()}`
  const membershipId = `mem_${ulid()}`
  const { error: orgErr } = await client.rpc('create_organization', {
    p_org_id: orgId,
    p_org_name: `Pkg Isolation Test Org ${label.toUpperCase()}`,
    p_membership_id: membershipId,
  })
  if (orgErr) throw new Error(`create_organization failed for ${email}: ${orgErr.message}`)

  // create_organization only grants client_admin; orientation_packages writes
  // require content_approver (HowDesign-DataModel.md §4.1) — add it via the
  // service role since there's no invite flow yet that can grant it.
  const { error: roleErr } = await admin
    .from('org_memberships')
    .update({ roles: ['client_admin', 'content_approver'] })
    .eq('id', membershipId)
  if (roleErr) throw new Error(`role grant failed for ${email}: ${roleErr.message}`)

  const siteId = `site_${ulid()}`
  const { error: siteErr } = await client
    .from('sites')
    .insert({ id: siteId, org_id: orgId, name: `Pkg Isolation Test Site ${label.toUpperCase()}` })
  if (siteErr) throw new Error(`site insert failed for ${email}: ${siteErr.message}`)

  const packageId = `pkg_${ulid()}`
  const { error: pkgErr } = await client.from('orientation_packages').insert(packageRow(packageId, orgId, siteId, created.user.id))
  if (pkgErr) throw new Error(`package insert failed for ${email}: ${pkgErr.message}`)

  return { userId: created.user.id, client, orgId, siteId, packageId }
}

before(async () => {
  tenantA = await provisionTenant('a')
  tenantB = await provisionTenant('b')
})

after(async () => {
  const orgIds = [tenantA?.orgId, tenantB?.orgId].filter((id): id is string => Boolean(id))
  const userIds = [tenantA?.userId, tenantB?.userId].filter((id): id is string => Boolean(id))

  if (orgIds.length > 0) {
    await admin.from('orientation_packages').delete().in('org_id', orgIds)
    await admin.from('sites').delete().in('org_id', orgIds)
    await admin.from('org_memberships').delete().in('org_id', orgIds)
    await admin.from('organizations').delete().in('id', orgIds)
  }
  for (const id of userIds) {
    await admin.from('users').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id)
  }
})

test("tenant A cannot read tenant B's orientation package", async () => {
  const { data, error } = await tenantA.client.from('orientation_packages').select('id').eq('id', tenantB.packageId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("tenant B cannot read tenant A's orientation package", async () => {
  const { data, error } = await tenantB.client.from('orientation_packages').select('id').eq('id', tenantA.packageId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("each tenant's unfiltered orientation_packages listing contains only their own package", async () => {
  const { data: pkgsA } = await tenantA.client.from('orientation_packages').select('id')
  assert.deepEqual(pkgsA?.map((p) => p.id), [tenantA.packageId])

  const { data: pkgsB } = await tenantB.client.from('orientation_packages').select('id')
  assert.deepEqual(pkgsB?.map((p) => p.id), [tenantB.packageId])
})

test("tenant B cannot write an orientation package into tenant A's org", async () => {
  const hostileId = `pkg_${ulid()}`
  const { error } = await tenantB.client
    .from('orientation_packages')
    .insert(packageRow(hostileId, tenantA.orgId, tenantA.siteId, tenantB.userId))
  assert.ok(error, 'expected RLS to reject the cross-tenant insert')

  const { data: leaked } = await admin
    .from('orientation_packages')
    .select('id')
    .eq('org_id', tenantA.orgId)
    .neq('id', tenantA.packageId)
  assert.deepEqual(leaked, [], 'no foreign package should have been inserted into org A')
})

test('a client_admin without content_approver cannot write an orientation package', async () => {
  const email = `pkg-isolation-test-nonapprover-${RUN_ID}@example.com`
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'NonApprover', family_name: 'Test' },
  })
  if (createErr || !created.user) throw new Error(`createUser failed: ${createErr?.message}`)

  const client = createClient(SUPABASE_URL, ANON_KEY)
  await client.auth.signInWithPassword({ email, password: PASSWORD })

  const orgId = `org_${ulid()}`
  const membershipId = `mem_${ulid()}`
  await client.rpc('create_organization', { p_org_id: orgId, p_org_name: 'NonApprover Org', p_membership_id: membershipId })
  // Deliberately left as client_admin only — no content_approver granted.

  const siteId = `site_${ulid()}`
  await client.from('sites').insert({ id: siteId, org_id: orgId, name: 'NonApprover Site' })

  const pkgId = `pkg_${ulid()}`
  const { error } = await client.from('orientation_packages').insert(packageRow(pkgId, orgId, siteId, created.user.id))
  assert.ok(error, 'expected RLS to reject a write from a client_admin lacking content_approver')

  await admin.from('sites').delete().eq('org_id', orgId)
  await admin.from('org_memberships').delete().eq('org_id', orgId)
  await admin.from('organizations').delete().eq('id', orgId)
  await admin.from('users').delete().eq('id', created.user.id)
  await admin.auth.admin.deleteUser(created.user.id)
})
