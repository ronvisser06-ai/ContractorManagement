// Regression net (CLAUDE.md §7): proves RLS — not app code — is what stops
// one org from reading or writing another org's data. Run with `npm test`.
//
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local via `node --env-file`).
// Talks to the real Supabase project configured in .env.local — it seeds two
// throwaway users/orgs/sites via the admin API and deletes them afterward.

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
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

let tenantA!: Tenant
let tenantB!: Tenant

async function provisionTenant(label: 'a' | 'b'): Promise<Tenant> {
  const email = `isolation-test-${label}-${RUN_ID}@example.com`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'Isolation', family_name: label.toUpperCase() },
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
    p_org_name: `Isolation Test Org ${label.toUpperCase()}`,
    p_membership_id: membershipId,
  })
  if (orgErr) throw new Error(`create_organization failed for ${email}: ${orgErr.message}`)

  const siteId = `site_${ulid()}`
  const { error: siteErr } = await client
    .from('sites')
    .insert({ id: siteId, org_id: orgId, name: `Isolation Test Site ${label.toUpperCase()}` })
  if (siteErr) throw new Error(`site insert failed for ${email}: ${siteErr.message}`)

  return { userId: created.user.id, client, orgId, siteId }
}

before(async () => {
  tenantA = await provisionTenant('a')
  tenantB = await provisionTenant('b')
})

after(async () => {
  const orgIds = [tenantA?.orgId, tenantB?.orgId].filter((id): id is string => Boolean(id))
  const userIds = [tenantA?.userId, tenantB?.userId].filter((id): id is string => Boolean(id))

  if (orgIds.length > 0) {
    await admin.from('sites').delete().in('org_id', orgIds)
    await admin.from('org_memberships').delete().in('org_id', orgIds)
    await admin.from('organizations').delete().in('id', orgIds)
  }
  for (const id of userIds) {
    await admin.from('users').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id)
  }
})

test("tenant A cannot read tenant B's organization", async () => {
  const { data, error } = await tenantA.client.from('organizations').select('id').eq('id', tenantB.orgId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("tenant B cannot read tenant A's organization", async () => {
  const { data, error } = await tenantB.client.from('organizations').select('id').eq('id', tenantA.orgId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("tenant A cannot read tenant B's sites", async () => {
  const { data, error } = await tenantA.client.from('sites').select('id').eq('org_id', tenantB.orgId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("tenant B cannot read tenant A's sites", async () => {
  const { data, error } = await tenantB.client.from('sites').select('id').eq('org_id', tenantA.orgId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("each tenant's unfiltered organizations listing contains only their own org", async () => {
  const { data: orgsA } = await tenantA.client.from('organizations').select('id')
  assert.deepEqual(orgsA?.map((o) => o.id), [tenantA.orgId])

  const { data: orgsB } = await tenantB.client.from('organizations').select('id')
  assert.deepEqual(orgsB?.map((o) => o.id), [tenantB.orgId])
})

test("each tenant's unfiltered sites listing contains only their own site", async () => {
  const { data: sitesA } = await tenantA.client.from('sites').select('id')
  assert.deepEqual(sitesA?.map((s) => s.id), [tenantA.siteId])

  const { data: sitesB } = await tenantB.client.from('sites').select('id')
  assert.deepEqual(sitesB?.map((s) => s.id), [tenantB.siteId])
})

test("tenant B cannot write a site into tenant A's org", async () => {
  const { error } = await tenantB.client
    .from('sites')
    .insert({ id: `site_${ulid()}`, org_id: tenantA.orgId, name: 'Hostile Site' })
  assert.ok(error, 'expected RLS to reject the cross-tenant insert')

  const { data: leaked } = await admin
    .from('sites')
    .select('id')
    .eq('org_id', tenantA.orgId)
    .neq('id', tenantA.siteId)
  assert.deepEqual(leaked, [], 'no foreign site should have been inserted into org A')
})
