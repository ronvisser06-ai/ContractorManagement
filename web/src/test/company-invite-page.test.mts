/**
 * F1 Step 3 — invite acceptance page.
 *  - safeNextPath: only same-site paths survive a ?next= after login
 *  - get_company_invitation: callable signed out with the token; returns
 *    display data only (no ids, no token); reports used / replaced / expired
 *  - accept_company_invite (M1, took a user id) no longer exists
 */

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import { invitePath, safeNextPath } from '../lib/http/safe-next.ts'

// ── safeNextPath (pure) ───────────────────────────────────────────────────────

describe('safeNextPath', () => {
  it('keeps same-site paths, including the invite path with its token', () => {
    assert.equal(safeNextPath('/company'), '/company')
    const p = invitePath('a'.repeat(64))
    assert.equal(safeNextPath(p), p)
  })
  it('rejects anything that could leave the site', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'evil', '', '/x\u0000y', ' javascript:alert(1)']) {
      assert.equal(safeNextPath(bad), null, JSON.stringify(bad))
    }
    assert.equal(safeNextPath(undefined), null)
    assert.equal(safeNextPath(42), null)
  })
})

// ── get_company_invitation (real Supabase) ───────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) throw new Error('Missing Supabase env vars')

const RUN_ID = ulid().toLowerCase()
const PASSWORD = 'F1InvitePage123!'
const email = (l: string) => `f1s3-${l}-${RUN_ID}@example.com`
const newId = (p: string) => `${p}${ulid()}`
const token64 = () => randomBytes(32).toString('hex')

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

describe('get_company_invitation — real Supabase', () => {
  const orgId = newId('org_')
  let companyId = ''
  let pendingToken = ''
  let caClient: SupabaseClient
  let caId = ''

  before(async () => {
    const { data } = await admin.auth.admin.createUser({ email: email('ca'), password: PASSWORD, email_confirm: true, user_metadata: { given_name: 'F1S3', family_name: 'CA' } })
    caId = data.user!.id
    await admin.from('organizations').insert({ id: orgId, name: 'F1S3 Org' })
    await admin.from('org_memberships').insert({ id: newId('om_'), user_id: caId, org_id: orgId, roles: ['client_admin'], status: 'active' })
    caClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    await caClient.auth.signInWithPassword({ email: email('ca'), password: PASSWORD })

    companyId = newId('cco_')
    pendingToken = token64()
    const { error } = await caClient.rpc('create_contractor_company', {
      p_org_id: orgId, p_company_id: companyId, p_link_id: newId('ccl_'), p_invitation_id: newId('inv_'),
      p_token: pendingToken, p_legal_name: 'F1S3 Gamma Coatings', p_admin_email: email('nominee'), p_admin_type: 'third_party',
    })
    if (error) throw new Error(error.message)
  })

  after(async () => {
    await admin.from('invitations').delete().eq('company_id', companyId)
    await admin.from('client_company_links').delete().eq('company_id', companyId)
    await admin.from('contractor_companies').delete().eq('id', companyId)
    await admin.from('org_memberships').delete().eq('org_id', orgId)
    await admin.from('organizations').delete().eq('id', orgId)
    await admin.from('users').delete().eq('id', caId)
    await admin.auth.admin.deleteUser(caId)
  })

  it('signed out, the token holder sees display data only', async () => {
    const { data, error } = await anon.rpc('get_company_invitation', { p_token: pendingToken })
    assert.equal(error, null, error?.message)
    assert.equal(data.length, 1)
    assert.deepEqual(data[0], {
      company_name: 'F1S3 Gamma Coatings', org_name: 'F1S3 Org', admin_type: 'third_party',
      email: email('nominee'), status: 'pending', expired: false,
    }, 'no ids, no token')
  })

  it('unknown or malformed tokens return nothing', async () => {
    for (const t of [token64(), 'short', '']) {
      const { data, error } = await anon.rpc('get_company_invitation', { p_token: t })
      assert.equal(error, null)
      assert.deepEqual(data, [], JSON.stringify(t))
    }
  })

  it('reports a replaced nomination as revoked and an old date as expired', async () => {
    const newToken = token64()
    const { error } = await caClient.rpc('replace_admin_nomination', {
      p_org_id: orgId, p_company_id: companyId, p_invitation_id: newId('inv_'), p_token: newToken,
      p_email: email('nominee2'), p_admin_type: 'company_staff',
    })
    assert.equal(error, null, error?.message)
    const old = await anon.rpc('get_company_invitation', { p_token: pendingToken })
    assert.equal(old.data[0].status, 'revoked')

    await admin.from('invitations').update({ expires_at: new Date(Date.now() - 3_600_000).toISOString() }).eq('token', newToken)
    const exp = await anon.rpc('get_company_invitation', { p_token: newToken })
    assert.deepEqual({ status: exp.data[0].status, expired: exp.data[0].expired }, { status: 'pending', expired: true })
  })

  it('the old accept_company_invite RPC (took a user id) is gone', async () => {
    const { error } = await admin.rpc('accept_company_invite', { p_token: 'x', p_user_id: caId, p_membership_id: 'm', p_legal_name: 'x' })
    assert.ok(error && /not find|does not exist|PGRST202/i.test(`${error.code} ${error.message}`), `${error?.code} ${error?.message}`)
  })
})
