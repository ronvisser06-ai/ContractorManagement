// Drives lib/companies/define.ts (the "add a contractor company" flow) against a SCRATCH database with migrations
// 0000–0019, through PostgREST, as signed-in users, so the real function signatures, grants and messages are exercised.
// Refuses anything that is not localhost: ConTrak's own tests run against production.
//
//   SCRATCH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/contrak_full \
//   SCRATCH_API_URL=http://127.0.0.1:54362 SCRATCH_JWT_SECRET=... node scripts/check-define-company-flow.mjs
// (PostgREST on the scratch database; SCRATCH_API_URL answers /rest/v1/..., as Supabase does.)

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { defineCompany, parseDefineForm } from '../src/lib/companies/define.ts'
import { addCompanyAdmin } from '../src/lib/companies/admins.ts'

const { SCRATCH_DATABASE_URL: dbUrl, SCRATCH_API_URL: api, SCRATCH_JWT_SECRET: secret } = process.env
if (!dbUrl || !api || !secret) throw new Error('Set SCRATCH_DATABASE_URL, SCRATCH_API_URL and SCRATCH_JWT_SECRET.')
for (const u of [dbUrl, api]) if (!/(127\.0\.0\.1|localhost)/.test(u)) throw new Error('Refusing: the scratch services must be on localhost.')

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} })
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims) => {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`
}
const clientFor = (token) => createClient(api, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
const asUser = (id) => clientFor(jwt({ sub: id, role: 'authenticated' }))
const service = clientFor(jwt({ role: 'service_role' }))

const tag = Date.now().toString(36)
const results = []
const mails = []
const send = (ok = true) => async (m) => { mails.push(m); return ok }

async function user(label) {
  const id = crypto.randomUUID()
  await sql`insert into auth.users (id, email) values (${id}, ${`${label}.${tag}@example.test`})`
  await sql`insert into users (id, given_name, family_name, primary_email) values (${id}, ${label}, 'T', ${`${label}.${tag}@example.test`}) on conflict (id) do nothing`
  return id
}
const org = async (id, name, admin, staff) => {
  await sql`insert into organizations (id, name) values (${id}, ${name})`
  if (admin) await sql`insert into org_memberships (id, user_id, org_id, roles, status) values (${`om_a_${id}`}, ${admin}, ${id}, ${['client_admin']}::org_role[], 'active')`
  if (staff) await sql`insert into org_memberships (id, user_id, org_id, roles, status) values (${`om_s_${id}`}, ${staff}, ${id}, ${['foreman']}::org_role[], 'active')`
}

const adminA = await user('adminA'), staffA = await user('staffA'), adminB = await user('adminB'), outsider = await user('outsider')
await org(`org_a_${tag}`, 'Client A', adminA, staffA)
await org(`org_b_${tag}`, 'Client B', adminB)
const A = { id: `org_a_${tag}`, name: 'Client A' }
const B = { id: `org_b_${tag}`, name: 'Client B' }
const deps = (who, o, ok = true) => ({ supabase: asUser(who), admin: service, org: o, send: send(ok), origin: 'https://app.example' })
const form = (over = {}) => ({ legal_name: `Apex ${tag} Electric Ltd`, contact_email: `office@apex-${tag}.test`, contact_name: 'Pat', contact_phone: '403 555 0100', custom_capabilities: '', admin_type: 'external', admin_email: `boss@apex-${tag}.test`, ...over })
const input = (over, caps = ['Electrical', 'Scaffolding']) => { const p = parseDefineForm(form(over), caps); assert.ok(p.ok, p.error); return p.input }

async function check(name, fn) {
  mails.length = 0
  try { await fn(); results.push([true, name]) } catch (e) { results.push([false, `${name}: ${e.message}`]) }
}

await check('the form is read for shape, and the decision and admin fields are checked', async () => {
  for (const [over, text] of [[{ legal_name: ' ' }, /name is required/], [{ contact_email: 'nope' }, /not an email/], [{ admin_type: '' }, /Choose who/], [{ admin_type: 'in_house', admin_user_id: '' }, /Choose a member/], [{ admin_type: 'external', admin_email: 'x' }, /admin’s email/], [{ decision: 'link:x' }, /Unknown choice/], [{ decision: 'sudo' }, /Unknown choice/]]) {
    const p = parseDefineForm(form(over)); assert.equal(p.ok, false, JSON.stringify(over)); assert.match(p.error, text)
  }
  const p = parseDefineForm(form({ custom_capabilities: 'Stonework\n scaffolding \r\n stonework\nHeritage  repair, and more', contact_email: 'OFFICE@X.TEST' }), [' Electrical ', 'Scaffolding', 'Electrical', 'Camp, catering and janitorial'])
  // Ticked names first, then the extras typed; repeats (ignoring case) once; blanks gone.
  assert.deepEqual([p.input.tradeTypes, p.input.contactEmail], [['Electrical', 'Scaffolding', 'Camp, catering and janitorial', 'Stonework', 'Heritage repair, and more'], 'office@x.test'])
  assert.equal(parseDefineForm(form(), Array.from({ length: 61 }, (_, i) => `Thing ${i}`)).ok, false)
  // Linking to a company someone else defined needs no admin of ours.
  assert.ok(parseDefineForm({ legal_name: 'X', decision: 'link:cco_01HZZZZZZZZZZZZZZZZZZZZZZZ', admin_type: '' }).ok)
})

let created
await check('a new company: created, its admin invited by email with the type, and the org told nothing it did not ask for', async () => {
  const r = await defineCompany(deps(adminA, A), input())
  assert.equal(r.kind, 'created'); assert.equal(r.warning, null); assert.equal(r.invite, null)
  created = r.companyId
  const [c] = await sql`select legal_name, contact_phone, defined_by_org_id from contractor_companies where id = ${created}`
  assert.deepEqual([c.legal_name, c.defined_by_org_id], [`Apex ${tag} Electric Ltd`, A.id])
  // The trades typed on the form are the company's capabilities (migration 0020).
  assert.deepEqual((await sql`select k.code from company_capabilities cc join capabilities k on k.id = cc.capability_id where cc.company_id = ${created} order by 1`).map((x) => x.code), ['electrical', 'scaffolding'])
  const [inv] = await sql`select admin_type, email, status, org_id from invitations where company_id = ${created}`
  assert.deepEqual([inv.admin_type, inv.email, inv.status, inv.org_id], ['external', `boss@apex-${tag}.test`, 'pending', A.id])
  assert.equal(mails.length, 1); assert.equal(mails[0].to, `boss@apex-${tag}.test`)
  assert.match(mails[0].text, /^.*\n\nAccept: https:\/\/app\.example\/register\/company\?token=[0-9a-f]{64}/s)
  assert.equal((await sql`select status from client_company_links where company_id = ${created}`)[0].status, 'invited')
})

await check('with no mail service the token comes back for the dev link', async () => {
  const r = await defineCompany(deps(adminA, A, false), input({ legal_name: `Birch ${tag} Civil`, contact_email: '', admin_email: `b@birch-${tag}.test` }))
  assert.equal(r.kind, 'created'); assert.match(r.invite.token, /^[0-9a-f]{64}$/); assert.equal(r.invite.email, `b@birch-${tag}.test`)
})

await check('an in-house admin is made at once and no email goes', async () => {
  const r = await defineCompany(deps(adminA, A), input({ legal_name: `Cedar ${tag} Works`, contact_email: '', admin_type: 'in_house', admin_user_id: staffA, admin_email: '' }))
  assert.equal(r.kind, 'created'); assert.equal(r.invite, null); assert.equal(mails.length, 0)
  const [m] = await sql`select roles, admin_type, status from company_memberships where company_id = ${r.companyId} and user_id = ${staffA}`
  assert.deepEqual([m.roles, m.admin_type, m.status], [['contractor_admin'], 'in_house', 'active'])
  assert.equal((await sql`select status from client_company_links where company_id = ${r.companyId}`)[0].status, 'active')
})

await check('an in-house nominee from another org: the company is kept and the failure is said plainly', async () => {
  const r = await defineCompany(deps(adminA, A), input({ legal_name: `Dune ${tag} Haulage`, contact_email: '', admin_type: 'in_house', admin_user_id: outsider, admin_email: '' }))
  assert.equal(r.kind, 'created'); assert.match(r.warning, /could not be nominated: That person is not an active member/)
  assert.equal((await sql`select count(*)::int as n from contractor_companies where id = ${r.companyId}`)[0].n, 1)
})

await check('a look-alike is offered, not created; linking asks its admin; "anyway" creates', async () => {
  // Org B already has Apex, with an admin who can be told.
  const bAdmin = await user('bossB')
  await sql`insert into company_memberships (id, user_id, company_id, roles, admin_type, status) values (${`mem_${tag}`}, ${bAdmin}, ${created}, ${['contractor_admin']}::company_role[], 'external', 'active')`
  const before = (await sql`select count(*)::int as n from contractor_companies`)[0].n
  const first = await defineCompany(deps(adminB, B), input({ legal_name: `APEX ${tag} Electric Limited`, contact_email: '' }))
  assert.equal(first.kind, 'matches'); assert.deepEqual(first.matches.map((m) => [m.id, m.alreadyLinked]), [[created, false]])
  assert.equal((await sql`select count(*)::int as n from contractor_companies`)[0].n, before, 'looking creates nothing')

  const linked = await defineCompany(deps(adminB, B), input({ legal_name: `APEX ${tag} Electric Limited`, contact_email: '', decision: `link:${created}` }))
  assert.deepEqual([linked.kind, linked.companyId, linked.notified], ['linked', created, 1])
  assert.equal(mails.length, 1); assert.equal(mails[0].to, `bossB.${tag}@example.test`); assert.match(mails[0].text, /Client B has asked to link/)
  assert.equal((await sql`select status from client_company_links where org_id = ${B.id} and company_id = ${created}`)[0].status, 'invited')
  assert.equal((await sql`select count(*)::int as n from contractor_companies`)[0].n, before, 'linking creates no company')
  // Org B did not define it, so it nominated nobody.
  assert.equal((await sql`select count(*)::int as n from invitations where org_id = ${B.id}`)[0].n, 0)

  const other = await defineCompany(deps(adminB, B), input({ legal_name: `APEX ${tag} Electric Limited`, contact_email: '', decision: 'anyway' }))
  assert.equal(other.kind, 'created'); assert.equal((await sql`select count(*)::int as n from contractor_companies`)[0].n, before + 1)
})

await check('a link to a company that is not a match is refused', async () => {
  const r = await defineCompany(deps(adminB, B), input({ legal_name: 'Totally Unrelated Co', contact_email: '', decision: `link:${created}` }))
  assert.equal(r.kind, 'invalid'); assert.match(r.error, /does not match/)
})

await check('only a Client Admin: staff and strangers are refused with the database’s own words', async () => {
  for (const who of [staffA, outsider]) {
    const r = await defineCompany(deps(who, A), input({ legal_name: `Nope ${tag}` }))
    assert.equal(r.kind, 'invalid'); assert.match(r.error, /Only a Client Admin/)
  }
  assert.equal((await sql`select count(*)::int as n from contractor_companies where legal_name like ${`Nope ${tag}%`}`)[0].n, 0)
})

await check('a company admin invites another admin: the invitation carries the type, the mail goes, and bad input is refused', async () => {
  const boss = await user('companyBoss')
  await sql`insert into company_memberships (id, user_id, company_id, roles, admin_type, status) values (${`mem_boss_${tag}`}, ${boss}, ${created}, ${['contractor_admin']}::company_role[], 'external', 'active')`
  const d = (ok = true, who = boss) => ({ supabase: asUser(who), company: { id: created, name: 'Apex & Sons' }, send: send(ok), origin: 'https://app.example' })
  const r = await addCompanyAdmin(d(), { type: 'third_party', email: ' Consultant@Safety.test ' })
  assert.deepEqual([r.kind, r.invite], ['invited', null])
  const [inv] = await sql`select admin_type, email, org_id, created_by, status from invitations where company_id = ${created} and email = 'consultant@safety.test'`
  assert.deepEqual([inv.admin_type, inv.org_id, inv.created_by, inv.status], ['third_party', null, boss, 'pending'])
  assert.equal(mails.length, 1); assert.match(mails[0].text, /register\/company\?token=[0-9a-f]{64}/); assert.doesNotMatch(mails[0].html, /&amp;amp;|<strong>Apex &/)
  const dev = await addCompanyAdmin(d(false), { type: 'external', email: 'dev@person.test' })
  assert.match(dev.invite.token, /^[0-9a-f]{64}$/)
  for (const [input, text] of [[{ type: 'in_house', email: 'a@b.test' }, /Choose who/], [{ type: 'external', email: 'nope' }, /email address/]]) {
    const bad = await addCompanyAdmin(d(), input); assert.equal(bad.kind, 'invalid'); assert.match(bad.error, text)
  }
  const dup = await addCompanyAdmin(d(), { type: 'external', email: 'dev@person.test' })
  assert.equal(dup.kind, 'invalid'); assert.match(dup.error, /pending invite already exists/)
  const nope = await addCompanyAdmin(d(true, outsider), { type: 'external', email: 'x@y.test' })
  assert.equal(nope.kind, 'invalid'); assert.match(nope.error, /Only an admin of this company/)
})

const failed = results.filter(([ok]) => !ok)
for (const [ok, name] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await sql.end()
process.exit(failed.length ? 1 : 0)
