// Checks drizzle/migrations/0019_company_admins.sql (matching, defining a company, nominating and removing admins,
// and accepting a link or an invitation) against a SCRATCH Postgres that already has migrations 0000–0018 applied.
// Every check runs in a transaction that is rolled back. Refuses anything that is not localhost: ConTrak's own tests
// run against production and this must never.
//
//   SCRATCH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/contrak_full node scripts/check-company-admins-sql.mjs

import assert from 'node:assert/strict'
import postgres from 'postgres'

const url = process.env.SCRATCH_DATABASE_URL
if (!url) throw new Error('Set SCRATCH_DATABASE_URL to a scratch database on localhost.')
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('Refusing: the scratch database must be on localhost.')
const sql = postgres(url, { max: 1, onnotice: () => {} })

const results = []
let seq = 0
const tok = () => 'a'.repeat(64)

/** Each check gets a fresh world inside a rolled-back transaction. */
async function check(name, fn) {
  try {
    await sql.begin(async (tx) => {
      const w = await world(tx)
      await fn(tx, w)
      throw new Rollback()
    })
  } catch (e) {
    if (e instanceof Rollback) return results.push([true, name])
    results.push([false, `${name}: ${e.message}`])
    return
  }
}
class Rollback extends Error {}

async function world(tx) {
  const user = async (label) => {
    const id = crypto.randomUUID()
    await tx`insert into auth.users (id, email, raw_user_meta_data) values (${id}, ${`${label}.${seq++}@example.test`}, ${tx.json({ given_name: label, family_name: 'T' })})`
    await tx`insert into users (id, given_name, family_name, primary_email) values (${id}, ${label}, 'T', ${`${label}.${seq++}@example.test`}) on conflict (id) do nothing`
    return id
  }
  const org = async (id, name) => tx`insert into organizations (id, name) values (${id}, ${name})`
  const member = async (userId, orgId, roles) =>
    tx`insert into org_memberships (id, user_id, org_id, roles, status) values (${`om_${seq++}`}, ${userId}, ${orgId}, ${roles}::org_role[], 'active')`
  await org('org_1', 'Client One'); await org('org_2', 'Client Two')
  const w = { adminA: await user('adminA'), staffA: await user('staffA'), adminB: await user('adminB'), outsider: await user('outsider'), companyUser: await user('companyUser') }
  await member(w.adminA, 'org_1', ['client_admin'])
  await member(w.staffA, 'org_1', ['foreman'])
  await member(w.adminB, 'org_2', ['client_admin'])
  return w
}

/** Runs `fn` as an authenticated user. */
const as = async (tx, userId, fn) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`
  await tx`set local role authenticated`
  try {
    return await fn()
  } finally {
    // After a refusal the transaction (or its savepoint) is rolled back, which already undid the role.
    await tx`reset role`.catch(() => {})
  }
}
/** `fn` must be refused with a message matching `pattern`. It runs in a savepoint, so the check carries on after it. */
const rejects = async (tx, fn, pattern) => {
  try {
    await tx.savepoint(async () => { await fn() })
  } catch (e) {
    assert.match(String(e.message), pattern)
    return
  }
  assert.fail(`expected a refusal matching ${pattern}`)
}
let n = 0
const id = (p) => `${p}${++n}_${Date.now()}`
const define = (tx, org, name, o = {}) =>
  tx`select * from define_contractor_company(${org}, ${o.company ?? id('cco_')}, ${o.link ?? id('ccl_')}, ${name}, ${o.contact ?? null}, ${o.email ?? null}, ${null}, ${o.trades ?? ['Electrical']}, ${o.linkExisting ?? null}, ${o.anyway ?? false})`
const nominate = (tx, org, company, type, o = {}) =>
  tx`select nominate_company_admin(${org}, ${company}, ${type}, ${o.id ?? id('x_')}, ${o.user ?? null}, ${o.email ?? null}, ${o.token ?? null}) as t`

await check('normalised names: case, punctuation, "&" and one legal suffix do not matter', async (tx) => {
  const same = ['Acme Construction Ltd.', 'ACME CONSTRUCTION, LTD', 'acme construction', 'Acme  Construction Limited']
  const keys = (await Promise.all(same.map(async (s) => (await tx`select replace(normalise_company_name(${s}), ' ', '') as k`)[0].k)))
  assert.equal(new Set(keys).size, 1)
  const [a, b] = await Promise.all(['Smith & Sons Inc', 'Smith and Sons'].map(async (s) => (await tx`select replace(normalise_company_name(${s}), ' ', '') as k`)[0].k))
  assert.equal(a, b)
  const [c, d] = await Promise.all(['Acme Electric', 'Acme Electrical'].map(async (s) => (await tx`select replace(normalise_company_name(${s}), ' ', '') as k`)[0].k))
  assert.notEqual(c, d)
})

await check('defining a company records who defined it and waits for an admin', async (tx, w) => {
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', '  Apex Electric Ltd ', { contact: 'Pat', email: 'pat@apex.test' }))
  assert.equal(r.linked_existing, false)
  const c = (await tx`select * from contractor_companies where id = ${r.company_id}`)[0]
  assert.equal(c.legal_name, 'Apex Electric Ltd')
  assert.equal(c.defined_by_org_id, 'org_1')
  // Trades typed on the form are capabilities now (migration 0020): Electrical is a catalog entry.
  assert.deepEqual((await tx`select k.code from company_capabilities cc join capabilities k on k.id = cc.capability_id where cc.company_id = ${r.company_id}`).map((x) => x.code), ['electrical'])
  assert.equal((await tx`select status from client_company_links where company_id = ${r.company_id} and org_id = 'org_1'`)[0].status, 'invited')
})

await check('only a Client Admin of the org may match, define or nominate', async (tx, w) => {
  for (const u of [w.staffA, w.outsider, w.adminB]) {
    await rejects(tx, () => as(tx, u, () => tx`select * from match_contractor_companies('org_1', 'Apex')`), /Only a Client Admin/)
    await rejects(tx, () => as(tx, u, () => define(tx, 'org_1', 'Apex')), /Only a Client Admin/)
  }
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex'))
  await rejects(tx, () => as(tx, w.staffA, () => nominate(tx, 'org_1', r.company_id, 'in_house', { user: w.staffA })), /Only a Client Admin/)
})

await check('a company like an existing one is matched by name or email, and shows only an id and a name', async (tx, w) => {
  const [r] = await as(tx, w.adminB, () => define(tx, 'org_2', 'Apex Electric Ltd', { email: 'office@apex.test', contact: 'secret contact' }))
  const byName = await as(tx, w.adminA, () => tx`select * from match_contractor_companies('org_1', 'APEX ELECTRIC, Limited')`)
  assert.deepEqual(byName.map((m) => [m.company_id, m.legal_name, m.already_linked]), [[r.company_id, 'Apex Electric Ltd', false]])
  assert.deepEqual(Object.keys(byName[0]).sort(), ['already_linked', 'company_id', 'legal_name'])
  const byEmail = await as(tx, w.adminA, () => tx`select * from match_contractor_companies('org_1', 'Totally Different Name', 'OFFICE@apex.test')`)
  assert.equal(byEmail.length, 1)
  assert.equal((await as(tx, w.adminA, () => tx`select * from match_contractor_companies('org_1', 'Nothing Like It')`)).length, 0)
  assert.equal((await as(tx, w.adminA, () => tx`select * from match_contractor_companies('org_1', '   ')`)).length, 0)
  // And a disabled company is never offered.
  await tx`update contractor_companies set status = 'disabled' where id = ${r.company_id}`
  assert.equal((await as(tx, w.adminA, () => tx`select * from match_contractor_companies('org_1', 'Apex Electric')`)).length, 0)
})

await check('a duplicate is refused unless the org chooses to create it anyway', async (tx, w) => {
  await as(tx, w.adminB, () => define(tx, 'org_2', 'Apex Electric Ltd'))
  await rejects(tx, () => as(tx, w.adminA, () => define(tx, 'org_1', 'Apex Electric')), /already exists/)
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex Electric', { anyway: true }))
  assert.equal(r.linked_existing, false)
  assert.equal((await tx`select count(*)::int as n from contractor_companies where normalized_name = 'apexelectric'`)[0].n, 2)
})

await check('linking to an existing company creates a pending link, no company, and never to an arbitrary id', async (tx, w) => {
  const [theirs] = await as(tx, w.adminB, () => define(tx, 'org_2', 'Apex Electric Ltd'))
  const [other] = await as(tx, w.adminB, () => define(tx, 'org_2', 'Unrelated Plumbing'))
  const before = (await tx`select count(*)::int as n from contractor_companies`)[0].n
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex Electric', { linkExisting: theirs.company_id }))
  assert.deepEqual([r.company_id, r.linked_existing], [theirs.company_id, true])
  assert.equal((await tx`select count(*)::int as n from contractor_companies`)[0].n, before)
  assert.equal((await tx`select status from client_company_links where org_id = 'org_1' and company_id = ${theirs.company_id}`)[0].status, 'invited')
  await rejects(tx, () => as(tx, w.adminA, () => define(tx, 'org_1', 'Apex Electric', { linkExisting: other.company_id })), /does not match/)
  // Linking is not nominating: org 1 did not define it and cannot name its admins.
  await rejects(tx, () => as(tx, w.adminA, () => nominate(tx, 'org_1', theirs.company_id, 'external', { email: 'x@y.test', token: tok() })), /your organization defined/)
})

await check('an in-house nominee becomes an admin at once, the link goes active, and only a member of the org qualifies', async (tx, w) => {
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex'))
  await as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'in_house', { user: w.staffA }))
  const m = (await tx`select * from company_memberships where company_id = ${r.company_id}`)[0]
  assert.deepEqual([m.user_id, m.roles, m.admin_type, m.nominated_by_org_id, m.status], [w.staffA, ['contractor_admin'], 'in_house', 'org_1', 'active'])
  assert.equal((await tx`select status from client_company_links where company_id = ${r.company_id}`)[0].status, 'active')
  await rejects(tx, () => as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'in_house', { user: w.adminB })), /not an active member/)
  await rejects(tx, () => as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'in_house')), /Choose a member/)
  await tx`update org_memberships set status = 'disabled' where user_id = ${w.staffA}`
  await rejects(tx, () => as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'in_house', { user: w.staffA, id: id('y_') })), /not an active member/)
})

await check('an external or third-party nominee gets an invitation carrying the type; the checks refuse the rest', async (tx, w) => {
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex'))
  const t = (await as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'third_party', { email: ' Consultant@Safety.test ', token: tok() })))[0].t
  assert.equal(t, tok())
  const inv = (await tx`select * from invitations where company_id = ${r.company_id}`)[0]
  assert.deepEqual([inv.type, inv.email, inv.admin_type, inv.intended_roles, inv.status, inv.org_id, inv.created_by], ['company', 'Consultant@Safety.test', 'third_party', ['contractor_admin'], 'pending', 'org_1', w.adminA])
  await rejects(tx, () => as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'external', { email: 'consultant@safety.test', token: 'b'.repeat(64), id: id('z_') })), /pending invite already exists/)
  await rejects(tx, () => as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'external', { token: tok() })), /email address is required/)
  await rejects(tx, () => as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'external', { email: 'a@b.test', token: 'short' })), /token is required/)
})

await check('accepting an invitation records the admin type, keeps a name the org typed, and replaces an email-only placeholder', async (tx, w) => {
  const [named] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex Electric Ltd'))
  await as(tx, w.adminA, () => nominate(tx, 'org_1', named.company_id, 'third_party', { email: 'c@s.test', token: tok() }))
  const m1 = id('cm_')
  await tx`select accept_company_invite(${tok()}, ${w.companyUser}, ${m1}, 'Whatever They Typed')`
  const c = (await tx`select legal_name from contractor_companies where id = ${named.company_id}`)[0]
  assert.equal(c.legal_name, 'Apex Electric Ltd')
  const m = (await tx`select * from company_memberships where id = ${m1}`)[0]
  assert.deepEqual([m.admin_type, m.nominated_by_org_id, m.status], ['third_party', 'org_1', 'active'])
  assert.equal((await tx`select status from client_company_links where company_id = ${named.company_id}`)[0].status, 'active')
  // The old email-only path: a placeholder name, no admin type on the invitation.
  await tx`insert into contractor_companies (id, legal_name) values ('cco_stub', 'Invited: x@y.test')`
  await tx`insert into client_company_links (id, org_id, company_id, status) values ('ccl_stub', 'org_1', 'cco_stub', 'invited')`
  await tx`insert into invitations (id, type, token, email, org_id, company_id, intended_roles, expires_at, created_by, admin_type) values ('inv_stub', 'company', ${'c'.repeat(64)}, 'x@y.test', 'org_1', 'cco_stub', ${['contractor_admin']}, now() + interval '1 day', ${w.adminA}, null)`
  await tx`select accept_company_invite(${'c'.repeat(64)}, ${w.staffA}, 'cm_stub', 'Real Name Inc')`
  assert.equal((await tx`select legal_name from contractor_companies where id = 'cco_stub'`)[0].legal_name, 'Real Name Inc')
  assert.equal((await tx`select admin_type from company_memberships where id = 'cm_stub'`)[0].admin_type, 'external')
})

await check('a company must keep an admin, and who may remove one is limited', async (tx, w) => {
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex'))
  await as(tx, w.adminA, () => nominate(tx, 'org_1', r.company_id, 'in_house', { user: w.staffA, id: 'cm_a' }))
  await rejects(tx, () => as(tx, w.staffA, () => tx`select remove_company_admin('cm_a')`), /at least one admin/)
  await tx`insert into company_memberships (id, user_id, company_id, roles, admin_type, status) values ('cm_b', ${w.companyUser}, ${r.company_id}, ${['contractor_admin']}::company_role[], 'external', 'active')`
  // A stranger, another org's admin and the second admin's own org (not the nominator) cannot.
  await rejects(tx, () => as(tx, w.outsider, () => tx`select remove_company_admin('cm_a')`), /cannot remove/)
  await rejects(tx, () => as(tx, w.adminB, () => tx`select remove_company_admin('cm_a')`), /cannot remove/)
  // The org that nominated cm_a may remove it; cm_b was nominated by nobody, so org 1 may not remove cm_b.
  await rejects(tx, () => as(tx, w.adminA, () => tx`select remove_company_admin('cm_b')`), /cannot remove/)
  await as(tx, w.adminA, () => tx`select remove_company_admin('cm_a')`)
  const gone = (await tx`select * from company_memberships where id = 'cm_a'`)[0]
  assert.deepEqual([gone.roles, gone.admin_type, gone.nominated_by_org_id, gone.status], [[], null, null, 'disabled'])
  // Now cm_b is the last one.
  await rejects(tx, () => as(tx, w.companyUser, () => tx`select remove_company_admin('cm_b')`), /at least one admin/)
})

await check('removing an admin who is also a worker keeps the worker', async (tx, w) => {
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex'))
  await tx`insert into company_memberships (id, user_id, company_id, roles, admin_type, status) values ('cm_1', ${w.staffA}, ${r.company_id}, ${['contractor_admin', 'worker']}::company_role[], 'external', 'active'), ('cm_2', ${w.companyUser}, ${r.company_id}, ${['contractor_admin']}::company_role[], 'external', 'active')`
  await as(tx, w.companyUser, () => tx`select remove_company_admin('cm_1')`)
  const m = (await tx`select roles, status, admin_type from company_memberships where id = 'cm_1'`)[0]
  assert.deepEqual([m.roles, m.status, m.admin_type], [['worker'], 'active', null])
})

await check('a pending link is answered only by an admin of that company', async (tx, w) => {
  const [theirs] = await as(tx, w.adminB, () => define(tx, 'org_2', 'Apex Electric Ltd'))
  await as(tx, w.adminB, () => nominate(tx, 'org_2', theirs.company_id, 'in_house', { user: w.adminB }))
  await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex Electric', { linkExisting: theirs.company_id, link: 'ccl_x' }))
  for (const u of [w.adminA, w.outsider]) await rejects(tx, () => as(tx, u, () => tx`select respond_to_company_link('ccl_x', true)`), /Only an admin of the company/)
  await as(tx, w.adminB, () => tx`select respond_to_company_link('ccl_x', true)`)
  assert.equal((await tx`select status from client_company_links where id = 'ccl_x'`)[0].status, 'active')
  await rejects(tx, () => as(tx, w.adminB, () => tx`select respond_to_company_link('ccl_x', true)`), /No such pending link/)
  await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex Electric', { linkExisting: theirs.company_id, link: 'ccl_y' })).catch(() => {})
})

await check('declining a link removes it', async (tx, w) => {
  const [theirs] = await as(tx, w.adminB, () => define(tx, 'org_2', 'Apex Electric Ltd'))
  await as(tx, w.adminB, () => nominate(tx, 'org_2', theirs.company_id, 'in_house', { user: w.adminB }))
  await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex Electric', { linkExisting: theirs.company_id, link: 'ccl_x' }))
  await as(tx, w.adminB, () => tx`select respond_to_company_link('ccl_x', false)`)
  assert.equal((await tx`select count(*)::int as n from client_company_links where id = 'ccl_x'`)[0].n, 0)
})

await check('contractor_admin without an admin type is refused by the table, whoever tries', async (tx, w) => {
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex'))
  await rejects(tx, () => tx`insert into company_memberships (id, user_id, company_id, roles, status) values ('cm_bad', ${w.staffA}, ${r.company_id}, ${['contractor_admin']}::company_role[], 'active')`, /admin_type_matches_role/)
  await rejects(tx, () => tx`insert into company_memberships (id, user_id, company_id, roles, admin_type, status) values ('cm_bad2', ${w.staffA}, ${r.company_id}, ${['worker']}::company_role[], 'external', 'active')`, /admin_type_matches_role/)
})

await check('anon cannot call any of it, and the helper is not callable by a signed-in user', async (tx, w) => {
  await tx`set local role anon`
  for (const q of [`match_contractor_companies('org_1','x')`, `remove_company_admin('x')`, `respond_to_company_link('x', true)`])
    await rejects(tx, () => tx.unsafe(`select * from ${q}`), /permission denied/)
  await tx`reset role`
  await rejects(tx, () => as(tx, w.adminA, () => tx`select assert_client_admin('org_1')`), /permission denied/)
})

// A company with one admin (companyUser), defined by org_1, for the company-side checks.
const withAdmin = async (tx, w) => {
  const [r] = await as(tx, w.adminA, () => define(tx, 'org_1', 'Apex'))
  await tx`insert into company_memberships (id, user_id, company_id, roles, admin_type, nominated_by_org_id, status) values ('cm_ca', ${w.companyUser}, ${r.company_id}, ${['contractor_admin']}::company_role[], 'in_house', 'org_1', 'active')`
  return r.company_id
}

await check('a company’s admins see its admins and pending invitations; no one else does', async (tx, w) => {
  const co = await withAdmin(tx, w)
  await as(tx, w.companyUser, () => tx`select add_company_admin(${co}, 'third_party', 'inv_ta', 'Safety@Consult.test', ${tok()})`)
  const rows = await as(tx, w.companyUser, () => tx`select * from list_company_admins(${co})`)
  assert.equal(rows.length, 2)
  const adm = rows.find((r) => !r.pending), inv = rows.find((r) => r.pending)
  assert.deepEqual([adm.membership_id, adm.admin_type, adm.nominated_by, adm.name], ['cm_ca', 'in_house', 'Client One', 'companyUser T'])
  assert.deepEqual([inv.invitation_id, inv.admin_type, inv.email, inv.nominated_by], ['inv_ta', 'third_party', 'Safety@Consult.test', null])
  for (const u of [w.adminA, w.outsider, w.adminB, w.staffA]) await rejects(tx, () => as(tx, u, () => tx`select * from list_company_admins(${co})`), /Only an admin of this company/)
  // A disabled membership is not an admin, whatever roles it still lists.
  await tx`insert into company_memberships (id, user_id, company_id, roles, admin_type, status) values ('cm_off', ${w.staffA}, ${co}, ${['contractor_admin']}::company_role[], 'external', 'disabled')`
  assert.equal((await as(tx, w.companyUser, () => tx`select * from list_company_admins(${co})`)).some((r) => r.membership_id === 'cm_off'), false)
  // Expired, accepted and revoked invitations are not "pending".
  await tx`update invitations set expires_at = now() - interval '1 day' where id = 'inv_ta'`
  assert.equal((await as(tx, w.companyUser, () => tx`select * from list_company_admins(${co})`)).filter((r) => r.pending).length, 0)
})

await check('a company admin invites another admin by email; in-house is the org’s to nominate', async (tx, w) => {
  const co = await withAdmin(tx, w)
  assert.equal((await as(tx, w.companyUser, () => tx`select add_company_admin(${co}, 'external', 'inv_1', ' New@Person.test ', ${tok()}) as t`))[0].t, tok())
  const inv = (await tx`select org_id, admin_type, created_by, intended_roles, status from invitations where id = 'inv_1'`)[0]
  assert.deepEqual([inv.org_id, inv.admin_type, inv.created_by, inv.intended_roles, inv.status], [null, 'external', w.companyUser, ['contractor_admin'], 'pending'])
  await rejects(tx, () => as(tx, w.companyUser, () => tx`select add_company_admin(${co}, 'external', 'inv_2', 'new@person.test', ${'b'.repeat(64)})`), /pending invite already exists/)
  await rejects(tx, () => as(tx, w.companyUser, () => tx`select add_company_admin(${co}, 'in_house', 'inv_3', 'x@y.test', ${'c'.repeat(64)})`), /nominated by the client/)
  await rejects(tx, () => as(tx, w.companyUser, () => tx`select add_company_admin(${co}, 'external', 'inv_4', '', ${'d'.repeat(64)})`), /email address is required/)
  await rejects(tx, () => as(tx, w.companyUser, () => tx`select add_company_admin(${co}, 'external', 'inv_5', 'a@b.test', 'short')`), /token is required/)
  for (const u of [w.adminA, w.outsider, w.staffA]) await rejects(tx, () => as(tx, u, () => tx`select add_company_admin(${co}, 'external', 'inv_9', 'z@z.test', ${'e'.repeat(64)})`), /Only an admin of this company/)
  // The invitee can accept it, and it records no nominating org.
  await tx`select accept_company_invite(${tok()}, ${w.staffA}, 'cm_new', 'Ignored')`
  const m = (await tx`select admin_type, nominated_by_org_id, status from company_memberships where id = 'cm_new'`)[0]
  assert.deepEqual([m.admin_type, m.nominated_by_org_id, m.status], ['external', null, 'active'])
})

await check('a pending invitation can be revoked by the company’s admins only, and then cannot be accepted', async (tx, w) => {
  const co = await withAdmin(tx, w)
  await as(tx, w.companyUser, () => tx`select add_company_admin(${co}, 'external', 'inv_r', 'r@r.test', ${tok()})`)
  for (const u of [w.adminA, w.outsider]) await rejects(tx, () => as(tx, u, () => tx`select revoke_company_admin_invite('inv_r')`), /Only an admin of this company/)
  await as(tx, w.companyUser, () => tx`select revoke_company_admin_invite('inv_r')`)
  assert.equal((await tx`select status from invitations where id = 'inv_r'`)[0].status, 'revoked')
  await rejects(tx, () => as(tx, w.companyUser, () => tx`select revoke_company_admin_invite('inv_r')`), /No such pending invitation/)
  await rejects(tx, () => tx`select accept_company_invite(${tok()}, ${w.staffA}, 'cm_x', 'x')`, /already been used or revoked/)
})

await check('pending link requests are listed for the company’s admins, by org name, until answered', async (tx, w) => {
  const co = await withAdmin(tx, w)
  await as(tx, w.adminB, () => define(tx, 'org_2', 'Apex', { linkExisting: co, link: 'ccl_b' }))
  const rows = await as(tx, w.companyUser, () => tx`select * from list_pending_company_links(${co})`)
  assert.deepEqual(rows.map((r) => [r.link_id, r.org_name]), [['ccl_b', 'Client Two']])
  for (const u of [w.adminB, w.outsider]) await rejects(tx, () => as(tx, u, () => tx`select * from list_pending_company_links(${co})`), /Only an admin of this company/)
  await as(tx, w.companyUser, () => tx`select respond_to_company_link('ccl_b', true)`)
  assert.equal((await as(tx, w.companyUser, () => tx`select * from list_pending_company_links(${co})`)).length, 0)
})

await check('anon cannot call the company-side functions, and the helper is not callable by a signed-in user', async (tx, w) => {
  await tx`set local role anon`
  for (const q of [`list_company_admins('x')`, `list_pending_company_links('x')`, `add_company_admin('x','external','i','a@b.test','${'f'.repeat(64)}')`, `revoke_company_admin_invite('x')`])
    await rejects(tx, () => tx.unsafe(`select * from ${q}`), /permission denied/)
  await tx`reset role`
  await rejects(tx, () => as(tx, w.adminA, () => tx`select assert_company_admin('x')`), /permission denied/)
})

const failed = results.filter(([ok]) => !ok)
for (const [ok, name] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await sql.end()
process.exit(failed.length ? 1 : 0)
