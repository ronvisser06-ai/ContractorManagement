/**
 * F1 Step 4 — company side.
 *  - company_client_links (0020): the company's admins see every link with the
 *    org's name and status; workers, other companies' admins and the client
 *    orgs themselves get nothing
 *  - revoking a pending admin invitation (direct update under RLS): only the
 *    company's admins can
 */

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) throw new Error('Missing Supabase env vars')

const RUN = ulid().toLowerCase()
const PW = 'F1CompanySide123!'
const email = (l: string) => `f1s4-${l}-${RUN}@example.com`
const newId = (p: string) => `${p}${ulid()}`
const token64 = () => randomBytes(32).toString('hex')
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

describe('F1 Step 4 — company side', () => {
  const orgLinked = newId('org_'), orgAsking = newId('org_'), orgDeclined = newId('org_')
  const co = newId('cco_'), otherCo = newId('cco_')
  const ids: Record<string, string> = {}
  const c: Record<string, SupabaseClient> = {}
  let inviteId = ''

  before(async () => {
    for (const l of ['coAdmin', 'coWorker', 'otherAdmin', 'orgAdmin']) {
      const { data, error } = await admin.auth.admin.createUser({ email: email(l), password: PW, email_confirm: true, user_metadata: { given_name: 'F1S4', family_name: l } })
      if (error) throw new Error(error.message)
      ids[l] = data.user!.id
    }
    await admin.from('organizations').insert([
      { id: orgLinked, name: 'F1S4 Linked Org' },
      { id: orgAsking, name: 'F1S4 Asking Org' },
      { id: orgDeclined, name: 'F1S4 Declined Org' },
    ])
    await admin.from('org_memberships').insert({ id: newId('om_'), user_id: ids.orgAdmin, org_id: orgAsking, roles: ['client_admin'], status: 'active' })
    await admin.from('contractor_companies').insert([{ id: co, legal_name: 'F1S4 Company' }, { id: otherCo, legal_name: 'F1S4 Other Co' }])
    const mem = (u: string, company: string, roles: string[]) => ({ id: newId('mem_'), user_id: u, company_id: company, roles, onboarding_status: 'account_created', status: 'active' })
    await admin.from('company_memberships').insert([
      mem(ids.coAdmin, co, ['contractor_admin']),
      mem(ids.coWorker, co, ['worker']),
      mem(ids.otherAdmin, otherCo, ['contractor_admin']),
    ])
    await admin.from('client_company_links').insert([
      { id: newId('ccl_'), org_id: orgLinked, company_id: co, status: 'active', accepted_at: new Date().toISOString() },
      { id: newId('ccl_'), org_id: orgAsking, company_id: co, status: 'invited' },
      { id: newId('ccl_'), org_id: orgDeclined, company_id: co, status: 'declined' },
    ])
    inviteId = newId('inv_')
    await admin.from('invitations').insert({
      id: inviteId, type: 'company', token: token64(), channel: 'email', email: email('newadmin'), org_id: null, company_id: co,
      intended_roles: ['contractor_admin'], admin_type: 'company_staff', status: 'pending',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: ids.coAdmin,
    })
    for (const l of Object.keys(ids)) {
      c[l] = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
      const { error } = await c[l].auth.signInWithPassword({ email: email(l), password: PW })
      if (error) throw new Error(`${l}: ${error.message}`)
    }
  })

  after(async () => {
    await admin.from('invitations').delete().in('company_id', [co, otherCo])
    await admin.from('client_company_links').delete().in('company_id', [co, otherCo])
    await admin.from('company_memberships').delete().in('company_id', [co, otherCo])
    await admin.from('contractor_companies').delete().in('id', [co, otherCo])
    await admin.from('org_memberships').delete().eq('org_id', orgAsking)
    await admin.from('organizations').delete().in('id', [orgLinked, orgAsking, orgDeclined])
    const u = Object.values(ids)
    await admin.from('users').delete().in('id', u)
    for (const id of u) await admin.auth.admin.deleteUser(id)
  })

  it("the company's admin sees every client link with the org name — requests first", async () => {
    const { data, error } = await c.coAdmin.rpc('company_client_links', { p_company_id: co })
    assert.equal(error, null, error?.message)
    assert.deepEqual(
      (data ?? []).map((r: { org_name: string; status: string }) => [r.org_name, r.status]),
      [['F1S4 Asking Org', 'invited'], ['F1S4 Declined Org', 'declined'], ['F1S4 Linked Org', 'active']],
    )
  })

  it("a worker, another company's admin and the asking org itself see nothing", async () => {
    for (const who of ['coWorker', 'otherAdmin', 'orgAdmin']) {
      const { data, error } = await c[who].rpc('company_client_links', { p_company_id: co })
      assert.equal(error, null, `${who}: ${error?.message}`)
      assert.deepEqual(data, [], who)
    }
  })

  it("only the company's admin can revoke its pending admin invitation", async () => {
    for (const who of ['coWorker', 'otherAdmin']) {
      await c[who].from('invitations').update({ status: 'revoked' }).eq('id', inviteId)
      const { data } = await admin.from('invitations').select('status').eq('id', inviteId).single()
      assert.equal(data?.status, 'pending', `${who} must not revoke`)
    }
    const { error } = await c.coAdmin.from('invitations').update({ status: 'revoked' }).eq('id', inviteId).eq('company_id', co)
    assert.equal(error, null, error?.message)
    const { data } = await admin.from('invitations').select('status').eq('id', inviteId).single()
    assert.equal(data?.status, 'revoked')
  })
})
