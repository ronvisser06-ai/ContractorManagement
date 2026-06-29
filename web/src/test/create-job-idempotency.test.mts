// Regression test for the createJob idempotency / retry path.
//
// Verifies the DB mechanics that the fixed createJob action relies on:
//   1. failed job + same idempotency key → retry update succeeds (status → queued)
//   2. non-retryable job + same idempotency key → pre-check finds it (redirect path)
//   3. unique constraint still prevents a blind duplicate insert (regression guard)
//
// Does NOT invoke the Next.js server action directly (redirect() makes that
// awkward in a test runner). Instead it exercises the exact DB queries the
// action runs, using the same Supabase client construction pattern.
//
// Run with: npm test  (node --env-file=.env.local --test "src/test/**/*.test.mts")

import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ulid } from 'ulid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const PASSWORD = 'IdemTest123!'
const RUN_ID = ulid().toLowerCase()

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

let userId: string
let orgId: string
let siteId: string
let userClient!: SupabaseClient

before(async () => {
  const email = `idem-test-${RUN_ID}@example.com`
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'Idem', family_name: 'Test' },
  })
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`)
  userId = created.user.id

  userClient = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`)

  orgId = `org_${ulid()}`
  const { error: orgErr } = await userClient.rpc('create_organization', {
    p_org_id: orgId,
    p_org_name: `Idem Test Org ${RUN_ID}`,
    p_membership_id: `mem_${ulid()}`,
  })
  if (orgErr) throw new Error(`create_organization failed: ${orgErr.message}`)

  siteId = `site_${ulid()}`
  const { error: siteErr } = await userClient
    .from('sites')
    .insert({ id: siteId, org_id: orgId, name: `Idem Test Site` })
  if (siteErr) throw new Error(`site insert failed: ${siteErr.message}`)
})

after(async () => {
  if (orgId) {
    await admin.from('generation_jobs').delete().eq('org_id', orgId)
    await admin.from('sites').delete().eq('org_id', orgId)
    await admin.from('org_memberships').delete().eq('org_id', orgId)
    await admin.from('organizations').delete().eq('id', orgId)
  }
  if (userId) {
    await admin.from('users').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }
})

test('failed job: pre-check finds it and retry update resets status to queued', async () => {
  const jobId = `job_${ulid()}`
  const idemKey = `${siteId}:sha256:aabbcc${RUN_ID}`

  // Seed a failed job — simulates the state the user hits when they re-upload
  const { error: insertErr } = await userClient.from('generation_jobs').insert({
    id: jobId,
    org_id: orgId,
    site_id: siteId,
    created_by: userId,
    idempotency_key: idemKey,
    status: 'failed',
    current_stage: 'extracting',
    error: { error: 'extractor 500', code: 'EXTRACT_FAILED' },
  })
  assert.equal(insertErr, null, `seed insert failed: ${insertErr?.message}`)

  // Step 1: pre-check query (mirrors createJob's .select('id, status') call)
  const { data: existing, error: checkErr } = await userClient
    .from('generation_jobs')
    .select('id, status')
    .eq('idempotency_key', idemKey)
    .maybeSingle()
  assert.equal(checkErr, null)
  assert.ok(existing, 'pre-check should find the existing failed job')
  assert.equal(existing.status, 'failed')
  assert.equal(existing.id, jobId)

  // Step 2: retry update (mirrors the failed-branch update in createJob)
  const { error: updateErr } = await userClient
    .from('generation_jobs')
    .update({ status: 'queued', current_stage: 'queued', error: null, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
  assert.equal(updateErr, null, `retry update failed: ${updateErr?.message}`)

  // Step 3: confirm the job is now queued with error cleared
  const { data: retried } = await admin
    .from('generation_jobs')
    .select('status, current_stage, error')
    .eq('id', jobId)
    .single()
  assert.equal(retried?.status, 'queued')
  assert.equal(retried?.current_stage, 'queued')
  assert.equal(retried?.error, null)

  // Cleanup
  await admin.from('generation_jobs').delete().eq('id', jobId)
})

test('awaiting_approval job: pre-check finds it so createJob redirects rather than inserting', async () => {
  const jobId = `job_${ulid()}`
  const idemKey = `${siteId}:sha256:ddeeff${RUN_ID}`

  const { error: insertErr } = await userClient.from('generation_jobs').insert({
    id: jobId,
    org_id: orgId,
    site_id: siteId,
    created_by: userId,
    idempotency_key: idemKey,
    status: 'awaiting_approval',
    current_stage: 'awaiting_approval',
  })
  assert.equal(insertErr, null, `seed insert failed: ${insertErr?.message}`)

  // Pre-check finds the existing non-retryable job
  const { data: existing, error: checkErr } = await userClient
    .from('generation_jobs')
    .select('id, status')
    .eq('idempotency_key', idemKey)
    .maybeSingle()
  assert.equal(checkErr, null)
  assert.ok(existing, 'pre-check should find the awaiting_approval job')
  assert.equal(existing.id, jobId)
  assert.equal(existing.status, 'awaiting_approval')
  // createJob would redirect to /app/jobs/${existing.id}?notice=... — no insert attempted

  // Confirm the unique constraint would have fired on a blind insert
  const { error: dupErr } = await userClient.from('generation_jobs').insert({
    id: `job_${ulid()}`,
    org_id: orgId,
    site_id: siteId,
    created_by: userId,
    idempotency_key: idemKey,
  })
  assert.ok(dupErr, 'duplicate insert must be rejected by the unique constraint')
  assert.match(dupErr.message, /unique|duplicate/i)

  // Cleanup
  await admin.from('generation_jobs').delete().eq('id', jobId)
})

test('no existing job: insert succeeds (normal new-job path)', async () => {
  const jobId = `job_${ulid()}`
  const idemKey = `${siteId}:sha256:112233${RUN_ID}`

  // Pre-check returns null — createJob proceeds to upload + insert
  const { data: existing } = await userClient
    .from('generation_jobs')
    .select('id, status')
    .eq('idempotency_key', idemKey)
    .maybeSingle()
  assert.equal(existing, null, 'pre-check must return null for a fresh idempotency key')

  // Insert succeeds
  const { error: insertErr } = await userClient.from('generation_jobs').insert({
    id: jobId,
    org_id: orgId,
    site_id: siteId,
    created_by: userId,
    idempotency_key: idemKey,
  })
  assert.equal(insertErr, null, `new-job insert failed: ${insertErr?.message}`)

  // Cleanup
  await admin.from('generation_jobs').delete().eq('id', jobId)
})
