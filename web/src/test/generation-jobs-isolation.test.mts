// Regression net (CLAUDE.md §7) for generation_jobs — same pattern as
// two-tenant-isolation.test.mts. Proves RLS, not app code, stops one org from
// reading or writing another org's generation jobs. Run with `npm test`.
//
// Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local via `node --env-file`).
// Talks to the real Supabase project configured in .env.local — it seeds two
// throwaway users/orgs/sites/jobs via the admin API and deletes them afterward.

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
  jobId: string
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

let tenantA!: Tenant
let tenantB!: Tenant

async function provisionTenant(label: 'a' | 'b'): Promise<Tenant> {
  const email = `jobs-isolation-test-${label}-${RUN_ID}@example.com`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'JobsIsolation', family_name: label.toUpperCase() },
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
    p_org_name: `Jobs Isolation Test Org ${label.toUpperCase()}`,
    p_membership_id: membershipId,
  })
  if (orgErr) throw new Error(`create_organization failed for ${email}: ${orgErr.message}`)

  // create_organization grants client_admin, which is enough on its own to write
  // generation_jobs (Step 2 setup migration broadened the policy to client_admin
  // OR content_developer — content_developer isn't grantable yet, no invite flow).

  const siteId = `site_${ulid()}`
  const { error: siteErr } = await client
    .from('sites')
    .insert({ id: siteId, org_id: orgId, name: `Jobs Isolation Test Site ${label.toUpperCase()}` })
  if (siteErr) throw new Error(`site insert failed for ${email}: ${siteErr.message}`)

  const jobId = `job_${ulid()}`
  const { error: jobErr } = await client.from('generation_jobs').insert({
    id: jobId,
    org_id: orgId,
    site_id: siteId,
    created_by: created.user.id,
    idempotency_key: `${siteId}:isolation-test:${jobId}`,
  })
  if (jobErr) throw new Error(`job insert failed for ${email}: ${jobErr.message}`)

  return { userId: created.user.id, client, orgId, siteId, jobId }
}

before(async () => {
  tenantA = await provisionTenant('a')
  tenantB = await provisionTenant('b')
})

after(async () => {
  const orgIds = [tenantA?.orgId, tenantB?.orgId].filter((id): id is string => Boolean(id))
  const userIds = [tenantA?.userId, tenantB?.userId].filter((id): id is string => Boolean(id))

  if (orgIds.length > 0) {
    await admin.from('generation_jobs').delete().in('org_id', orgIds)
    await admin.from('sites').delete().in('org_id', orgIds)
    await admin.from('org_memberships').delete().in('org_id', orgIds)
    await admin.from('organizations').delete().in('id', orgIds)
  }
  for (const id of userIds) {
    await admin.from('users').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id)
  }
})

test("tenant A cannot read tenant B's generation job", async () => {
  const { data, error } = await tenantA.client.from('generation_jobs').select('id').eq('id', tenantB.jobId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("tenant B cannot read tenant A's generation job", async () => {
  const { data, error } = await tenantB.client.from('generation_jobs').select('id').eq('id', tenantA.jobId)
  assert.equal(error, null)
  assert.deepEqual(data, [])
})

test("each tenant's unfiltered generation_jobs listing contains only their own job", async () => {
  const { data: jobsA } = await tenantA.client.from('generation_jobs').select('id')
  assert.deepEqual(jobsA?.map((j) => j.id), [tenantA.jobId])

  const { data: jobsB } = await tenantB.client.from('generation_jobs').select('id')
  assert.deepEqual(jobsB?.map((j) => j.id), [tenantB.jobId])
})

test("tenant B cannot write a generation job into tenant A's org", async () => {
  const hostileJobId = `job_${ulid()}`
  const { error } = await tenantB.client.from('generation_jobs').insert({
    id: hostileJobId,
    org_id: tenantA.orgId,
    site_id: tenantA.siteId,
    created_by: tenantB.userId,
    idempotency_key: `${tenantA.siteId}:isolation-test:${hostileJobId}`,
  })
  assert.ok(error, 'expected RLS to reject the cross-tenant insert')

  const { data: leaked } = await admin
    .from('generation_jobs')
    .select('id')
    .eq('org_id', tenantA.orgId)
    .neq('id', tenantA.jobId)
  assert.deepEqual(leaked, [], 'no foreign job should have been inserted into org A')
})

test("tenant A cannot update tenant B's generation job", async () => {
  const { error, data } = await tenantA.client
    .from('generation_jobs')
    .update({ qa_flagged: true })
    .eq('id', tenantB.jobId)
    .select()
  assert.equal(error, null, 'RLS silently filters rather than erroring on a no-op update')
  assert.deepEqual(data, [])

  const { data: unchanged } = await admin
    .from('generation_jobs')
    .select('qa_flagged')
    .eq('id', tenantB.jobId)
    .single()
  assert.equal(unchanged?.qa_flagged, false)
})
