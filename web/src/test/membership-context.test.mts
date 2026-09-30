/**
 * F0 Step 1 — Membership context.
 *
 * Pure: resolveActive picks the cookie's membership only if the user holds it,
 * otherwise the oldest; a forged id can never select a foreign org/company.
 *
 * Real Supabase: a person with 1 org + 2 companies (admin in one, worker in the
 * other) + 1 disabled membership. getMyMemberships, run as that person, returns
 * exactly the active memberships with names and roles; run as an unrelated user
 * (RLS), it returns none of them.
 */

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ulid } from 'ulid'
import { resolveActive } from '../lib/context/resolve.ts'
import { getMyMemberships } from '../lib/context/query.ts'

// ── Pure selection logic ──────────────────────────────────────────────────────

describe('resolveActive', () => {
  const list = [
    { id: 'cco_A', name: 'Oldest' },
    { id: 'cco_B', name: 'Second' },
  ]

  it('returns the membership named by a valid cookie', () => {
    assert.equal(resolveActive(list, 'cco_B')?.id, 'cco_B')
  })

  it('ignores a forged/foreign cookie and falls back to the oldest', () => {
    assert.equal(resolveActive(list, 'cco_SOMEONE_ELSES')?.id, 'cco_A')
  })

  it('falls back to the oldest when there is no cookie', () => {
    assert.equal(resolveActive(list, undefined)?.id, 'cco_A')
    assert.equal(resolveActive(list, '')?.id, 'cco_A')
  })

  it('returns null when the user has no memberships of that kind', () => {
    assert.equal(resolveActive([], 'cco_A'), null)
  })
})

// ── Real Supabase ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) throw new Error('Missing Supabase env vars')

const PASSWORD = 'MemberCtx123!'
const RUN_ID = ulid().toLowerCase()
const email = (label: string) => `f0-ctx-${label}-${RUN_ID}@example.com`
const newId = (prefix: string) => `${prefix}${ulid()}`

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const orgId = newId('org_')
const coAdminId = newId('cco_') // person is contractor_admin here
const coWorkerId = newId('cco_') // person is only a worker here
const coDisabledId = newId('cco_') // person's membership here is disabled
const coOtherId = newId('cco_') // belongs to the unrelated user only
const userIds: string[] = []

let personId: string
let outsiderId: string
let personClient: SupabaseClient
let outsiderClient: SupabaseClient

async function createAuthUser(label: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(label),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'F0', family_name: label },
  })
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`)
  userIds.push(data.user.id)
  return data.user.id
}

async function signIn(label: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email: email(label), password: PASSWORD })
  if (error) throw new Error(`signIn(${label}): ${error.message}`)
  return client
}

async function insertOrThrow(table: string, row: Record<string, unknown>) {
  const { error } = await admin.from(table).insert(row)
  if (error) throw new Error(`${table} insert: ${error.message}`)
}

describe('getMyMemberships — real Supabase', () => {
  before(async () => {
    personId = await createAuthUser('person')
    outsiderId = await createAuthUser('outsider')

    await insertOrThrow('organizations', { id: orgId, name: 'F0 Client Org' })
    for (const [id, name] of [
      [coAdminId, 'F0 Admin Co'],
      [coWorkerId, 'F0 Worker Co'],
      [coDisabledId, 'F0 Disabled Co'],
      [coOtherId, 'F0 Outsider Co'],
    ]) {
      await insertOrThrow('contractor_companies', { id, legal_name: name })
    }

    await insertOrThrow('org_memberships', {
      id: newId('om_'),
      user_id: personId,
      org_id: orgId,
      roles: ['client_admin', 'content_approver'],
      status: 'active',
    })
    // Inserted in order so created_at ordering is deterministic: admin co first.
    await insertOrThrow('company_memberships', {
      id: newId('mem_'),
      user_id: personId,
      company_id: coAdminId,
      roles: ['contractor_admin'],
      onboarding_status: 'account_created',
      status: 'active',
    })
    await insertOrThrow('company_memberships', {
      id: newId('mem_'),
      user_id: personId,
      company_id: coWorkerId,
      roles: ['worker'],
      onboarding_status: 'account_created',
      status: 'active',
    })
    await insertOrThrow('company_memberships', {
      id: newId('mem_'),
      user_id: personId,
      company_id: coDisabledId,
      roles: ['worker'],
      onboarding_status: 'account_created',
      status: 'disabled',
    })
    await insertOrThrow('company_memberships', {
      id: newId('mem_'),
      user_id: outsiderId,
      company_id: coOtherId,
      roles: ['contractor_admin'],
      onboarding_status: 'account_created',
      status: 'active',
    })

    personClient = await signIn('person')
    outsiderClient = await signIn('outsider')
  })

  after(async () => {
    const companyIds = [coAdminId, coWorkerId, coDisabledId, coOtherId]
    await admin.from('company_memberships').delete().in('company_id', companyIds)
    await admin.from('org_memberships').delete().eq('org_id', orgId)
    await admin.from('contractor_companies').delete().in('id', companyIds)
    await admin.from('organizations').delete().eq('id', orgId)
    // Profile rows first (the auth trigger creates them; deleting the auth user
    // does not remove them), then the auth users.
    await admin.from('user_emails').delete().in('user_id', userIds)
    await admin.from('users').delete().in('id', userIds)
    for (const id of userIds) await admin.auth.admin.deleteUser(id)
  })

  it('returns every active org and company membership with names and roles', async () => {
    const mine = await getMyMemberships(personClient, personId)

    assert.equal(mine.orgs.length, 1)
    assert.equal(mine.orgs[0].id, orgId)
    assert.equal(mine.orgs[0].name, 'F0 Client Org')
    assert.deepEqual([...mine.orgs[0].roles].sort(), ['client_admin', 'content_approver'])

    assert.deepEqual(
      mine.companies.map((c) => [c.id, c.name, c.roles]),
      [
        [coAdminId, 'F0 Admin Co', ['contractor_admin']],
        [coWorkerId, 'F0 Worker Co', ['worker']],
      ],
      'both active companies, oldest first, with the role held in each',
    )
  })

  it('excludes disabled memberships', async () => {
    const mine = await getMyMemberships(personClient, personId)
    assert.ok(!mine.companies.some((c) => c.id === coDisabledId))
  })

  it('an unrelated user cannot read the person’s memberships (RLS)', async () => {
    const seen = await getMyMemberships(outsiderClient, personId)
    assert.equal(seen.orgs.length, 0)
    assert.equal(seen.companies.length, 0)
  })

  it('the unrelated user sees only their own company', async () => {
    const theirs = await getMyMemberships(outsiderClient, outsiderId)
    assert.deepEqual(theirs.orgs, [])
    assert.deepEqual(
      theirs.companies.map((c) => [c.id, c.name]),
      [[coOtherId, 'F0 Outsider Co']],
    )
  })

  it('a forged cookie for the outsider’s company cannot become the person’s active company', async () => {
    const mine = await getMyMemberships(personClient, personId)
    assert.equal(resolveActive(mine.companies, coOtherId)?.id, coAdminId)
    assert.equal(resolveActive(mine.companies, coWorkerId)?.id, coWorkerId)
  })
})
