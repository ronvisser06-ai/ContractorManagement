/**
 * F1 Step 1 — Org-defined contractor companies: schema, RPCs and RLS.
 *
 * Security (pre-existing holes this step closes):
 *  - a client admin cannot attach their org to a company by writing a link directly
 *  - a client admin cannot approve their own link request
 *  - a client admin cannot mint a company-admin invitation for a company they don't own
 *  - the token RPCs that take a user id are service-role only
 *
 * Feature:
 *  - create_contractor_company (details + admin nomination, duplicate guards)
 *  - find_company_matches (fuzzy name / business number / website; name only)
 *  - request_company_link + respond_to_link_request (company must accept)
 *  - accept_company_admin_invite (signed-in, email must match, takeover guard)
 *  - replace_admin_nomination, invite_company_admin, remove_company_admin (last-admin guard)
 *  - org_company_links / pending_link_requests (names for pending links)
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

const PASSWORD = 'F1CompanyDef123!'
const RUN_ID = ulid().toLowerCase()
const email = (label: string) => `f1-${label}-${RUN_ID}@example.com`.toLowerCase() // Auth stores emails lowercase
const newId = (prefix: string) => `${prefix}${ulid()}`
const token64 = () => randomBytes(32).toString('hex')

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Fixture state ─────────────────────────────────────────────────────────────

const orgA = newId('org_')
const orgB = newId('org_')
const existingCo = newId('cco_') // exists on the platform, NOT created by orgA/orgB
const otherCo = newId('cco_') // the third-party admin already runs this one
const stubCo = newId('cco_') // old-flow stub ("Invited: …") — must never appear in search
const userIds: Record<string, string> = {}
const companiesToClean: string[] = [existingCo, otherCo, stubCo]
const c: Record<string, SupabaseClient> = {}

async function createUser(label: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(label),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { given_name: 'F1', family_name: label },
  })
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`)
  userIds[label] = data.user.id
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

async function ins(table: string, row: Record<string, unknown>) {
  const { error } = await admin.from(table).insert(row)
  if (error) throw new Error(`${table} insert: ${error.message}`)
}

const membership = (user: string, company: string, roles: string[], adminType: string | null = null) => ({
  id: newId('mem_'),
  user_id: user,
  company_id: company,
  roles,
  onboarding_status: 'account_created',
  status: 'active',
  ...(adminType ? { admin_type: adminType } : {}),
})

// Calls create_contractor_company as `client` and returns {companyId, token, error}.
async function createCompany(
  client: SupabaseClient,
  orgId: string,
  fields: { name: string; adminLabel?: string; adminEmail?: string; adminType?: string; businessNumber?: string; website?: string; confirm?: boolean },
) {
  const companyId = newId('cco_')
  const token = token64()
  const { data, error } = await client.rpc('create_contractor_company', {
    p_org_id: orgId,
    p_company_id: companyId,
    p_link_id: newId('ccl_'),
    p_invitation_id: newId('inv_'),
    p_token: token,
    p_legal_name: fields.name,
    p_admin_email: fields.adminEmail ?? email(fields.adminLabel ?? 'nobody'),
    p_admin_type: fields.adminType ?? 'company_staff',
    p_trade_types: ['Scaffolding'],
    p_contact_name: 'Pat Contact',
    p_contact_email: 'pat@example.com',
    p_contact_phone: '+1 555 0100',
    p_business_number: fields.businessNumber ?? null,
    p_website: fields.website ?? null,
    p_confirm_not_duplicate: fields.confirm ?? false,
  })
  if (!error) companiesToClean.push(companyId)
  return { companyId, token, data, error }
}

const errText = (e: { message?: string } | null) => e?.message ?? ''

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('F1 Step 1 — org-defined companies', () => {
  let apexId: string // created by orgA, nominated admin = inHouse (client_staff)
  let apexToken: string

  before(async () => {
    for (const l of ['caA', 'devA', 'inHouse', 'caB', 'coAdmin', 'coWorker', 'tpAdmin', 'stranger']) await createUser(l)

    await ins('organizations', { id: orgA, name: 'F1 Org A' })
    await ins('organizations', { id: orgB, name: 'F1 Org B' })
    await ins('org_memberships', { id: newId('om_'), user_id: userIds.caA, org_id: orgA, roles: ['client_admin'], status: 'active' })
    await ins('org_memberships', { id: newId('om_'), user_id: userIds.devA, org_id: orgA, roles: ['content_developer'], status: 'active' })
    await ins('org_memberships', { id: newId('om_'), user_id: userIds.inHouse, org_id: orgA, roles: ['foreman'], status: 'active' })
    await ins('org_memberships', { id: newId('om_'), user_id: userIds.caB, org_id: orgB, roles: ['client_admin'], status: 'active' })

    await ins('contractor_companies', { id: existingCo, legal_name: 'F1 Existing Scaffolding Ltd.', business_number: 'BN123456789', website: 'https://www.existing-scaffold.example/about' })
    await ins('contractor_companies', { id: otherCo, legal_name: 'F1 Other Rigging Corp' })
    await ins('contractor_companies', { id: stubCo, legal_name: 'Invited: secret-contact@example.com' })
    await ins('company_memberships', membership(userIds.coAdmin, existingCo, ['contractor_admin'], 'company_staff'))
    await ins('company_memberships', membership(userIds.coWorker, existingCo, ['worker']))
    await ins('company_memberships', membership(userIds.tpAdmin, otherCo, ['contractor_admin'], 'third_party'))

    for (const l of ['caA', 'devA', 'inHouse', 'caB', 'coAdmin', 'coWorker', 'tpAdmin', 'stranger']) c[l] = await signIn(l)
  })

  after(async () => {
    await admin.from('invitations').delete().in('company_id', companiesToClean)
    await admin.from('client_company_links').delete().in('company_id', companiesToClean)
    await admin.from('company_memberships').delete().in('company_id', companiesToClean)
    await admin.from('org_memberships').delete().in('org_id', [orgA, orgB])
    await admin.from('contractor_companies').delete().in('id', companiesToClean)
    await admin.from('organizations').delete().in('id', [orgA, orgB])
    const ids = Object.values(userIds)
    await admin.from('user_emails').delete().in('user_id', ids)
    await admin.from('users').delete().in('id', ids)
    for (const id of ids) await admin.auth.admin.deleteUser(id)
  })

  // ── Security: no client can attach itself to a company ─────────────────────

  describe('Security', () => {
    it('client admin cannot write an ACTIVE link to a company directly', async () => {
      await c.caA.from('client_company_links').insert({ id: newId('ccl_'), org_id: orgA, company_id: existingCo, status: 'active' })
      const { data } = await admin.from('client_company_links').select('id').eq('org_id', orgA).eq('company_id', existingCo)
      assert.equal(data?.length ?? 0, 0, 'no link may be created by a direct insert')
      const { data: seen } = await c.caA.from('contractor_companies').select('id').eq('id', existingCo)
      assert.equal(seen?.length ?? 0, 0, 'company must stay invisible')
    })

    it('client admin cannot write even a pending link to a company their org did not create', async () => {
      const { error } = await c.caA.from('client_company_links').insert({ id: newId('ccl_'), org_id: orgA, company_id: existingCo, status: 'invited' })
      assert.ok(error, 'direct link insert must be refused (use request_company_link)')
    })

    it('client admin cannot approve their own pending link', async () => {
      const { error: reqErr } = await c.caB.rpc('request_company_link', { p_org_id: orgB, p_company_id: otherCo, p_link_id: newId('ccl_') })
      assert.equal(reqErr, null, errText(reqErr))
      await c.caB.from('client_company_links').update({ status: 'active' }).eq('org_id', orgB).eq('company_id', otherCo)
      const { data } = await admin.from('client_company_links').select('status').eq('org_id', orgB).eq('company_id', otherCo).single()
      assert.equal(data?.status, 'invited', 'status must not change without the company accepting')
    })

    it('client admin cannot mint a company-admin invitation for a company they do not own', async () => {
      const { error } = await c.caA.from('invitations').insert({
        id: newId('inv_'), type: 'company', token: token64(), channel: 'email', email: email('caA'),
        org_id: orgA, company_id: existingCo, intended_roles: ['contractor_admin'], status: 'pending',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: userIds.caA,
      })
      assert.ok(error, 'invitation for a foreign company must be refused')
    })

    it('token RPCs that take a user id are not callable by signed-in users or anonymously', async () => {
      const a = await c.caA.rpc('accept_company_invite', { p_token: 'x', p_user_id: userIds.caA, p_membership_id: 'm', p_legal_name: 'x' })
      assert.ok(a.error, 'accept_company_invite must be refused for a signed-in user')
      const b = await anon.rpc('claim_worker_invite', { p_token: 'x', p_claiming_user_id: userIds.caA, p_provisional_user_id: userIds.caA })
      assert.ok(b.error, 'claim_worker_invite must be refused anonymously')
      for (const e of [a.error, b.error]) assert.ok(/permission denied|42501|not find/i.test(`${e?.code} ${e?.message}`), `${e?.code} ${e?.message}`)
    })
  })

  // ── Create ─────────────────────────────────────────────────────────────────

  describe('create_contractor_company', () => {
    it('client admin creates a company with details and nominates an in-house admin', async () => {
      const r = await createCompany(c.caA, orgA, { name: 'F1 Apex Scaffolding', adminLabel: 'inHouse', adminType: 'client_staff', businessNumber: 'ab 987-654-321', website: 'apex-f1.example' })
      assert.equal(r.error, null, errText(r.error))
      apexId = r.companyId
      apexToken = r.token

      const { data: co } = await c.caA.from('contractor_companies').select('legal_name, business_number, website, created_by_org_id').eq('id', apexId).single()
      assert.deepEqual(co, { legal_name: 'F1 Apex Scaffolding', business_number: 'AB987654321', website: 'apex-f1.example', created_by_org_id: orgA }, 'creating org reads the profile; business number normalized')
      const { data: link } = await admin.from('client_company_links').select('status').eq('org_id', orgA).eq('company_id', apexId).single()
      assert.equal(link?.status, 'invited')
      const { data: inv } = await admin.from('invitations').select('type, status, email, admin_type, intended_roles, org_id').eq('token', apexToken).single()
      assert.deepEqual(inv, { type: 'company', status: 'pending', email: email('inHouse'), admin_type: 'client_staff', intended_roles: ['contractor_admin'], org_id: orgA })
    })

    it('another org cannot read the company profile it did not create', async () => {
      const { data } = await c.caB.from('contractor_companies').select('id').eq('id', apexId)
      assert.equal(data?.length ?? 0, 0)
    })

    it('a non-admin org member cannot create a company', async () => {
      const r = await createCompany(c.devA, orgA, { name: 'F1 Should Fail Co', adminLabel: 'devA' })
      assert.match(errText(r.error), /not_client_admin/)
    })

    it("another org's admin cannot create a company for org A", async () => {
      const r = await createCompany(c.caB, orgA, { name: 'F1 Cross Org Co', adminLabel: 'caB' })
      assert.match(errText(r.error), /not_client_admin/)
    })

    it('a near-identical name is refused as a possible duplicate', async () => {
      const r = await createCompany(c.caB, orgB, { name: 'F1 APEX-SCAFFOLDING, Ltd.', adminLabel: 'caB' })
      assert.match(errText(r.error), /possible_duplicate/)
    })

    it('...unless the org confirms it is a different company', async () => {
      const r = await createCompany(c.caB, orgB, { name: 'F1 Apex Scaffolding Inc', adminLabel: 'caB', confirm: true })
      assert.equal(r.error, null, errText(r.error))
    })

    it('the same business number is refused even when confirmed', async () => {
      const r = await createCompany(c.caB, orgB, { name: 'Totally Different Name', adminLabel: 'caB', businessNumber: 'bn 123-456-789', confirm: true })
      assert.match(errText(r.error), /duplicate_business_number/)
    })
  })

  // ── Search ─────────────────────────────────────────────────────────────────

  describe('find_company_matches', () => {
    it('fuzzy name search (typo) returns name only, with no link for the searching org', async () => {
      const { data, error } = await c.caB.rpc('find_company_matches', { p_org_id: orgB, p_query: 'f1 apex scafolding' })
      assert.equal(error, null, errText(error))
      const hit = (data ?? []).find((r: { company_id: string }) => r.company_id === apexId)
      assert.ok(hit, `expected Apex in results: ${JSON.stringify(data)}`)
      assert.deepEqual(Object.keys(hit).sort(), ['company_id', 'legal_name', 'link_status'], 'name only — no contacts, workers or other clients')
      assert.equal(hit.link_status, null)
    })

    it('matches on business number regardless of formatting', async () => {
      const { data } = await c.caB.rpc('find_company_matches', { p_org_id: orgB, p_query: 'BN-123 456 789' })
      assert.ok((data ?? []).some((r: { company_id: string }) => r.company_id === existingCo), JSON.stringify(data))
    })

    it('matches on website domain', async () => {
      const { data } = await c.caB.rpc('find_company_matches', { p_org_id: orgB, p_query: 'http://existing-scaffold.example' })
      assert.ok((data ?? []).some((r: { company_id: string }) => r.company_id === existingCo), JSON.stringify(data))
    })

    it('shows the searching org its own link status ("already linked" instead of missing)', async () => {
      const { data } = await c.caA.rpc('find_company_matches', { p_org_id: orgA, p_query: 'apex scaffolding' })
      const own = (data ?? []).find((r: { company_id: string }) => r.company_id === apexId)
      assert.equal(own?.link_status, 'invited')
    })

    it('never returns old-flow stub companies (their name holds a contact email)', async () => {
      const { data } = await c.caA.rpc('find_company_matches', { p_org_id: orgA, p_query: 'invited secret contact' })
      assert.ok(!(data ?? []).some((r: { company_id: string }) => r.company_id === stubCo), JSON.stringify(data))
    })

    it('non-admins and outsiders cannot search', async () => {
      for (const who of ['devA', 'stranger']) {
        const { error } = await c[who].rpc('find_company_matches', { p_org_id: orgA, p_query: 'apex' })
        assert.match(errText(error), /not_client_admin/, who)
      }
    })
  })

  // ── Link requests ──────────────────────────────────────────────────────────

  describe('request_company_link / respond_to_link_request', () => {
    let linkId: string

    it('org B requests a link to an existing company — it stays invisible until accepted', async () => {
      const { data, error } = await c.caB.rpc('request_company_link', { p_org_id: orgB, p_company_id: existingCo, p_link_id: newId('ccl_') })
      assert.equal(error, null, errText(error))
      linkId = data as string
      const { data: co } = await c.caB.from('contractor_companies').select('id').eq('id', existingCo)
      assert.equal(co?.length ?? 0, 0, 'no profile while pending')
      const { data: mem } = await c.caB.from('company_memberships').select('id').eq('company_id', existingCo)
      assert.equal(mem?.length ?? 0, 0, 'no workers while pending')
      const { data: links } = await c.caB.rpc('org_company_links', { p_org_id: orgB })
      const row = (links ?? []).find((l: { company_id: string }) => l.company_id === existingCo)
      assert.deepEqual({ name: row?.legal_name, status: row?.status }, { name: 'F1 Existing Scaffolding Ltd.', status: 'invited' }, 'org sees the name of what it requested')
    })

    it('the company admin sees the request with the org name', async () => {
      const { data, error } = await c.coAdmin.rpc('pending_link_requests', { p_company_id: existingCo })
      assert.equal(error, null, errText(error))
      assert.ok((data ?? []).some((r: { link_id: string; org_name: string }) => r.link_id === linkId && r.org_name === 'F1 Org B'), JSON.stringify(data))
    })

    it("a worker of the company and the requesting org cannot answer the request", async () => {
      for (const who of ['coWorker', 'caB']) {
        const { error } = await c[who].rpc('respond_to_link_request', { p_link_id: linkId, p_accept: true })
        assert.match(errText(error), /not_company_admin/, who)
      }
      const { data } = await c.caB.rpc('pending_link_requests', { p_company_id: existingCo })
      assert.deepEqual(data, [], 'org cannot read the company inbox')
    })

    it('the company admin accepts — org B can now see the company and its workers', async () => {
      const { data, error } = await c.coAdmin.rpc('respond_to_link_request', { p_link_id: linkId, p_accept: true })
      assert.equal(error, null, errText(error))
      assert.equal(data, 'active')
      const { data: co } = await c.caB.from('contractor_companies').select('id').eq('id', existingCo)
      assert.equal(co?.length, 1)
      const { data: mem } = await c.caB.from('company_memberships').select('id').eq('company_id', existingCo)
      assert.ok((mem?.length ?? 0) >= 1)
    })

    it('requesting again once linked is refused', async () => {
      const { error } = await c.caB.rpc('request_company_link', { p_org_id: orgB, p_company_id: existingCo, p_link_id: newId('ccl_') })
      assert.match(errText(error), /already_linked/)
    })

    it('a declined request grants nothing; the org may ask again', async () => {
      const { data: id } = await c.caA.rpc('request_company_link', { p_org_id: orgA, p_company_id: existingCo, p_link_id: newId('ccl_') })
      const { data: st } = await c.coAdmin.rpc('respond_to_link_request', { p_link_id: id, p_accept: false })
      assert.equal(st, 'declined')
      const { data: co } = await c.caA.from('contractor_companies').select('id').eq('id', existingCo)
      assert.equal(co?.length ?? 0, 0)
      const { error } = await c.caA.rpc('request_company_link', { p_org_id: orgA, p_company_id: existingCo, p_link_id: newId('ccl_') })
      assert.equal(error, null, errText(error))
      const { data: link } = await admin.from('client_company_links').select('status').eq('org_id', orgA).eq('company_id', existingCo).single()
      assert.equal(link?.status, 'invited')
    })
  })

  // ── Accepting admin invites ────────────────────────────────────────────────

  describe('accept_company_admin_invite', () => {
    it('someone else cannot accept the invite (email must match)', async () => {
      const { error } = await c.stranger.rpc('accept_company_admin_invite', { p_token: apexToken, p_membership_id: newId('mem_') })
      assert.match(errText(error), /email_mismatch/)
    })

    it('the in-house nominee (an existing org user) accepts while signed in', async () => {
      const { data, error } = await c.inHouse.rpc('accept_company_admin_invite', { p_token: apexToken, p_membership_id: newId('mem_') })
      assert.equal(error, null, errText(error))
      assert.equal(data, apexId)
      const { data: m } = await admin.from('company_memberships').select('roles, admin_type, status').eq('company_id', apexId).eq('user_id', userIds.inHouse).single()
      assert.deepEqual(m, { roles: ['contractor_admin'], admin_type: 'client_staff', status: 'active' })
      const { data: link } = await admin.from('client_company_links').select('status').eq('org_id', orgA).eq('company_id', apexId).single()
      assert.equal(link?.status, 'active', "creating org's link activates")
      const { data: inv } = await admin.from('invitations').select('status, accepted_user_id').eq('token', apexToken).single()
      assert.deepEqual(inv, { status: 'accepted', accepted_user_id: userIds.inHouse })
    })

    it('the token cannot be reused', async () => {
      const { error } = await c.inHouse.rpc('accept_company_admin_invite', { p_token: apexToken, p_membership_id: newId('mem_') })
      assert.match(errText(error), /already_used/)
    })

    it('an expired invite is refused; the org replaces the nomination and the third-party admin accepts', async () => {
      const r = await createCompany(c.caA, orgA, { name: 'F1 Beacon Electrical', adminLabel: 'tpAdmin', adminType: 'third_party' })
      assert.equal(r.error, null, errText(r.error))
      await admin.from('invitations').update({ expires_at: new Date(Date.now() - 3_600_000).toISOString() }).eq('token', r.token)
      const exp = await c.tpAdmin.rpc('accept_company_admin_invite', { p_token: r.token, p_membership_id: newId('mem_') })
      assert.match(errText(exp.error), /expired/)

      const newToken = token64()
      const rep = await c.caA.rpc('replace_admin_nomination', { p_org_id: orgA, p_company_id: r.companyId, p_invitation_id: newId('inv_'), p_token: newToken, p_email: email('tpAdmin'), p_admin_type: 'third_party' })
      assert.equal(rep.error, null, errText(rep.error))
      const { data: old } = await admin.from('invitations').select('status').eq('token', r.token).single()
      assert.equal(old?.status, 'revoked', 'previous nomination revoked')

      const ok = await c.tpAdmin.rpc('accept_company_admin_invite', { p_token: newToken, p_membership_id: newId('mem_') })
      assert.equal(ok.error, null, errText(ok.error))
      const { data: mine } = await admin.from('company_memberships').select('company_id, admin_type').eq('user_id', userIds.tpAdmin).eq('status', 'active')
      assert.equal(mine?.length, 2, 'third-party admin now runs two companies')
      assert.ok(mine?.every((m) => m.admin_type === 'third_party'))

      const late = await c.caA.rpc('replace_admin_nomination', { p_org_id: orgA, p_company_id: r.companyId, p_invitation_id: newId('inv_'), p_token: token64(), p_email: email('devA'), p_admin_type: 'company_staff' })
      assert.match(errText(late.error), /company_has_admin/, 'org cannot change admins once the company has one')
      const notCreator = await c.caB.rpc('replace_admin_nomination', { p_org_id: orgB, p_company_id: r.companyId, p_invitation_id: newId('inv_'), p_token: token64(), p_email: email('caB'), p_admin_type: 'company_staff' })
      assert.match(errText(notCreator.error), /not_creator/)
    })

    it('a forged invitation for a company the org did not create cannot be accepted (takeover guard)', async () => {
      const forged = token64()
      await ins('invitations', {
        id: newId('inv_'), type: 'company', token: forged, channel: 'email', email: email('caA'), org_id: orgA,
        company_id: existingCo, intended_roles: ['contractor_admin'], admin_type: 'client_staff', status: 'pending',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: userIds.caA,
      })
      const { error } = await c.caA.rpc('accept_company_admin_invite', { p_token: forged, p_membership_id: newId('mem_') })
      assert.match(errText(error), /invalid_invitation/)
      const { data } = await admin.from('company_memberships').select('id').eq('company_id', existingCo).eq('user_id', userIds.caA)
      assert.equal(data?.length ?? 0, 0)
    })
  })

  // ── Company admins manage admins ───────────────────────────────────────────

  describe('invite_company_admin / remove_company_admin', () => {
    it('a company admin invites another admin, who accepts', async () => {
      const tok = token64()
      const { error } = await c.inHouse.rpc('invite_company_admin', { p_company_id: apexId, p_invitation_id: newId('inv_'), p_token: tok, p_email: email('devA'), p_admin_type: 'company_staff' })
      assert.equal(error, null, errText(error))
      const acc = await c.devA.rpc('accept_company_admin_invite', { p_token: tok, p_membership_id: newId('mem_') })
      assert.equal(acc.error, null, errText(acc.error))
    })

    it("a worker and another company's admin cannot invite admins", async () => {
      for (const [who, co] of [['coWorker', existingCo], ['coAdmin', apexId]] as const) {
        const { error } = await c[who].rpc('invite_company_admin', { p_company_id: co, p_invitation_id: newId('inv_'), p_token: token64(), p_email: email('stranger'), p_admin_type: 'company_staff' })
        assert.match(errText(error), /not_company_admin/, who)
      }
    })

    it('admins can remove another admin, but never the last one', async () => {
      const { data: devMem } = await admin.from('company_memberships').select('id').eq('company_id', apexId).eq('user_id', userIds.devA).single()
      const rm = await c.inHouse.rpc('remove_company_admin', { p_membership_id: devMem!.id })
      assert.equal(rm.error, null, errText(rm.error))
      const { data: after } = await admin.from('company_memberships').select('roles, status, admin_type').eq('id', devMem!.id).single()
      assert.deepEqual(after, { roles: [], status: 'disabled', admin_type: null })

      const { data: me } = await admin.from('company_memberships').select('id').eq('company_id', apexId).eq('user_id', userIds.inHouse).single()
      const last = await c.inHouse.rpc('remove_company_admin', { p_membership_id: me!.id })
      assert.match(errText(last.error), /last_admin/)

      const other = await c.coAdmin.rpc('remove_company_admin', { p_membership_id: me!.id })
      assert.match(errText(other.error), /not_company_admin/)
    })
  })
})
