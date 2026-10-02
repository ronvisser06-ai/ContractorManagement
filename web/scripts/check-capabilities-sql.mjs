// Checks drizzle/migrations/0020_capability_catalog.sql (the shared catalog, a company's capabilities, who may read and set
// them, and the copy of the old free-text trades) against a SCRATCH Postgres with migrations 0000–0020 applied. Each check
// runs in a rolled-back transaction. Refuses anything that is not localhost: ConTrak's own tests run against production.
//
//   SCRATCH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/contrak_full node scripts/check-capabilities-sql.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const url = process.env.SCRATCH_DATABASE_URL
if (!url) throw new Error('Set SCRATCH_DATABASE_URL to a scratch database on localhost.')
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('Refusing: the scratch database must be on localhost.')
const sql = postgres(url, { max: 1, onnotice: () => {} })
const migration = readFileSync(new URL('../drizzle/migrations/0020_capability_catalog.sql', import.meta.url), 'utf8')

class Rollback extends Error {}
const results = []
let n = 0
const id = (p) => `${p}${++n}_${Date.now()}`

async function check(name, fn) {
  try {
    await sql.begin(async (tx) => {
      await fn(tx, await world(tx))
      throw new Rollback()
    })
    results.push([true, name])
  } catch (e) {
    results.push(e instanceof Rollback ? [true, name] : [false, `${name}: ${e.message}`])
  }
}

async function world(tx) {
  const user = async (label) => {
    const uid = crypto.randomUUID()
    await tx`insert into auth.users (id, email) values (${uid}, ${`${label}.${n++}@example.test`})`
    await tx`insert into users (id, given_name, family_name, primary_email) values (${uid}, ${label}, 'T', ${`${label}.${n++}@example.test`}) on conflict (id) do nothing`
    return uid
  }
  const w = { boss: await user('boss'), worker: await user('worker'), orgAdmin: await user('orgAdmin'), otherOrg: await user('otherOrg'), outsider: await user('outsider') }
  await tx`insert into organizations (id, name) values ('org_1', 'Client One'), ('org_2', 'Client Two')`
  await tx`insert into org_memberships (id, user_id, org_id, roles, status) values ('om1', ${w.orgAdmin}, 'org_1', ${['client_admin']}::org_role[], 'active'), ('om2', ${w.otherOrg}, 'org_2', ${['client_admin']}::org_role[], 'active')`
  await tx`insert into contractor_companies (id, legal_name, defined_by_org_id) values ('cco_1', 'Apex', 'org_1'), ('cco_2', 'Birch', 'org_1')`
  await tx`insert into company_memberships (id, user_id, company_id, roles, admin_type, status) values ('m1', ${w.boss}, 'cco_1', ${['contractor_admin']}::company_role[], 'external', 'active'), ('m2', ${w.worker}, 'cco_1', ${['worker']}::company_role[], null, 'active')`
  await tx`insert into client_company_links (id, org_id, company_id, status) values ('l1', 'org_1', 'cco_1', 'active'), ('l2', 'org_2', 'cco_1', 'invited')`
  return w
}

const as = async (tx, userId, fn) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`
  await tx`set local role authenticated`
  try {
    return await fn()
  } finally {
    await tx`reset role`.catch(() => {})
  }
}
const rejects = async (tx, fn, pattern) => {
  try {
    await tx.savepoint(async () => { await fn() })
  } catch (e) {
    assert.match(String(e.message), pattern)
    return
  }
  assert.fail(`expected a refusal matching ${pattern}`)
}
const set = (tx, who, company, catalog, custom) => as(tx, who, async () => (await tx`select set_company_capabilities(${company}, ${catalog}, ${custom}) as n`)[0].n)
const held = async (tx, company = 'cco_1') =>
  (await tx`select k.code, c.custom_label from company_capabilities c left join capabilities k on k.id = c.capability_id where c.company_id = ${company} order by k.code nulls last, c.custom_label`).map((r) => r.code ?? `custom:${r.custom_label}`)
const cap = async (tx, code) => (await tx`select id from capabilities where code = ${code}`)[0].id

await check('the catalog is seeded in the project’s own wording, uniquely coded, grouped, and not retired', async (tx) => {
  const rows = await tx`select code, label, category, retired_at from capabilities`
  assert.ok(rows.length >= 40, `${rows.length} entries`)
  assert.equal(new Set(rows.map((r) => r.code)).size, rows.length)
  assert.ok(rows.every((r) => r.category && r.label && r.retired_at === null))
  assert.ok(['electrical', 'scaffolding', 'welding', 'safety-services'].every((c) => rows.some((r) => r.code === c)))
})

await check('anyone signed in reads the catalog; no one writes it through the app; anon sees nothing', async (tx, w) => {
  assert.ok((await as(tx, w.outsider, () => tx`select count(*)::int as n from capabilities`))[0].n >= 40)
  for (const q of [`insert into capabilities (id, code, label, category) values ('x', 'x', 'X', 'X')`, `update capabilities set label = 'Hacked'`, `delete from capabilities`])
    await rejects(tx, () => as(tx, w.boss, () => tx.unsafe(q)), /permission denied/)
  await tx`set local role anon`
  await rejects(tx, () => tx`select * from capabilities`, /permission denied/)
  await tx`reset role`
})

await check('a company’s admin sets its capabilities: catalog entries and custom labels, replacing what was there', async (tx, w) => {
  const [el, sc] = [await cap(tx, 'electrical'), await cap(tx, 'scaffolding')]
  assert.equal(await set(tx, w.boss, 'cco_1', [el, sc], ['Heritage restoration']), 3)
  assert.deepEqual(await held(tx), ['electrical', 'scaffolding', 'custom:Heritage restoration'])
  // Replacing: one stays, one goes, a new custom label comes.
  assert.equal(await set(tx, w.boss, 'cco_1', [el], ['Stonework']), 2)
  assert.deepEqual(await held(tx), ['electrical', 'custom:Stonework'])
  // The same again changes nothing, and the rows stay the same rows.
  const before = (await tx`select id from company_capabilities where company_id = 'cco_1' order by id`).map((r) => r.id)
  assert.equal(await set(tx, w.boss, 'cco_1', [el], ['Stonework']), 2)
  assert.deepEqual((await tx`select id from company_capabilities where company_id = 'cco_1' order by id`).map((r) => r.id), before)
  assert.equal(await set(tx, w.boss, 'cco_1', [], []), 0)
})

await check('only the company’s own admins may set them: not a worker, a client admin, another org or a stranger', async (tx, w) => {
  for (const u of [w.worker, w.orgAdmin, w.otherOrg, w.outsider])
    await rejects(tx, () => set(tx, u, 'cco_1', [], ['x']), /Only an admin of this company/)
  await rejects(tx, () => set(tx, w.boss, 'cco_2', [], ['x']), /Only an admin of this company/)
})

await check('a typed name that is a catalog entry becomes the entry, and custom names are de-duplicated ignoring case and punctuation', async (tx, w) => {
  await set(tx, w.boss, 'cco_1', [], [' ELECTRICAL ', 'scaffolding', 'Camp, catering and janitorial', 'Heritage  Restoration', 'heritage restoration!', 'safety-services'])
  assert.deepEqual(await held(tx), ['camp-catering', 'electrical', 'safety-services', 'scaffolding', 'custom:Heritage Restoration'])
  // Asking for the same entry by id and by name holds it once.
  const el = await cap(tx, 'electrical')
  assert.equal(await set(tx, w.boss, 'cco_1', [el, el], ['Electrical']), 1)
})

await check('an unknown, over-long or empty name, or too many, is refused and changes nothing', async (tx, w) => {
  await set(tx, w.boss, 'cco_1', [], ['Keep me'])
  await rejects(tx, () => set(tx, w.boss, 'cco_1', ['cap_nope'], []), /Unknown capability/)
  await rejects(tx, () => set(tx, w.boss, 'cco_1', [], ['x'.repeat(81)]), /at most 80/)
  await rejects(tx, () => set(tx, w.boss, 'cco_1', [], ['!!!']), /letters or digits/)
  await rejects(tx, () => set(tx, w.boss, 'cco_1', [], Array.from({ length: 61 }, (_, i) => `Thing ${i}`)), /at most 60/)
  assert.deepEqual(await held(tx), ['custom:Keep me'])
  assert.equal(await set(tx, w.boss, 'cco_1', [], ['', '  ']), 0, 'blank names are ignored, not refused')
})

await check('a retired entry cannot be newly chosen, but a company that holds it keeps it', async (tx, w) => {
  const el = await cap(tx, 'electrical')
  await set(tx, w.boss, 'cco_1', [el], [])
  await tx`update capabilities set retired_at = now() where id = ${el}`
  assert.equal(await set(tx, w.boss, 'cco_1', [el], ['Other']), 2, 'kept')
  // Another company cannot take it up.
  await tx`insert into company_memberships (id, user_id, company_id, roles, admin_type, status) values ('m9', ${w.worker}, 'cco_2', ${['contractor_admin']}::company_role[], 'external', 'active')`
  await rejects(tx, () => set(tx, w.worker, 'cco_2', [el], []), /retired/)
  // A typed name matching only a retired entry is a custom label, not the entry.
  await tx`delete from company_capabilities where company_id = 'cco_1'`
  await set(tx, w.boss, 'cco_1', [], ['Electrical'])
  assert.deepEqual(await held(tx), ['custom:Electrical'])
})

await check('there is no direct insert, update or delete for anyone signed in, whoever they are', async (tx, w) => {
  await set(tx, w.boss, 'cco_1', [], ['x'])
  for (const u of [w.boss, w.orgAdmin]) {
    await rejects(tx, () => as(tx, u, () => tx`insert into company_capabilities (id, company_id, custom_label) values ('z', 'cco_1', 'sneaky')`), /permission denied/)
    await rejects(tx, () => as(tx, u, () => tx`update company_capabilities set custom_label = 'y'`), /permission denied/)
    await rejects(tx, () => as(tx, u, () => tx`delete from company_capabilities`), /permission denied/)
  }
})

await check('the company’s people and organizations actively linked to it read its capabilities; no one else does', async (tx, w) => {
  await set(tx, w.boss, 'cco_1', [], ['Visible'])
  await set(tx, w.boss, 'cco_1', [await cap(tx, 'welding')], ['Visible'])
  const see = (u) => as(tx, u, async () => (await tx`select count(*)::int as n from company_capabilities where company_id = 'cco_1'`)[0].n)
  assert.equal(await see(w.boss), 2)
  assert.equal(await see(w.worker), 2, 'its own worker')
  assert.equal(await see(w.orgAdmin), 2, 'an organization with an active link')
  assert.equal(await see(w.otherOrg), 0, 'an organization whose link is only invited')
  assert.equal(await see(w.outsider), 0)
  await tx`update client_company_links set status = 'active' where id = 'l2'`
  assert.equal(await see(w.otherOrg), 2)
})

await check('a row is a catalog entry or a custom label, never both or neither, and neither repeats', async (tx) => {
  const el = await cap(tx, 'electrical')
  await rejects(tx, () => tx`insert into company_capabilities (id, company_id, capability_id, custom_label) values ('a', 'cco_1', ${el}, 'x')`, /one_kind/)
  await rejects(tx, () => tx`insert into company_capabilities (id, company_id) values ('b', 'cco_1')`, /one_kind/)
  await tx`insert into company_capabilities (id, company_id, capability_id) values ('c', 'cco_1', ${el})`
  await rejects(tx, () => tx`insert into company_capabilities (id, company_id, capability_id) values ('d', 'cco_1', ${el})`, /catalog_idx/)
  await tx`insert into company_capabilities (id, company_id, custom_label) values ('e', 'cco_1', 'Stonework')`
  await rejects(tx, () => tx`insert into company_capabilities (id, company_id, custom_label) values ('f', 'cco_1', 'STONEWORK')`, /custom_idx/)
})

await check('a company an org defines starts with the typed trades as capabilities, and trade_types is left alone', async (tx, w) => {
  const [r] = await as(tx, w.orgAdmin, () => tx`select * from define_contractor_company('org_1', ${id('cco_')}, ${id('ccl_')}, 'Cedar Works', null, null, null, ${['Electrical', 'Heritage masonry', 'electrical', ' ']}, null, false)`)
  assert.deepEqual(await held(tx, r.company_id), ['electrical', 'custom:Heritage masonry'])
  assert.deepEqual((await tx`select trade_types from contractor_companies where id = ${r.company_id}`)[0].trade_types, [])
})

await check('what companies already typed is copied: a catalog name becomes the entry, the rest custom, duplicates once, nothing lost', async (tx) => {
  await tx`update contractor_companies set trade_types = ${['Electrical', ' scaffolding ', 'Heritage Masonry Restoration', 'electrical', 'WELDING & fabrication', '', '!!', 'x'.repeat(81)]} where id = 'cco_1'`
  await tx`update contractor_companies set trade_types = ${['Roofing']} where id = 'cco_2'`
  const copy = migration.slice(migration.indexOf('-- ── what companies already typed'))
  await tx.unsafe(copy)
  assert.deepEqual(await held(tx, 'cco_1'), ['electrical', 'scaffolding', 'custom:Heritage Masonry Restoration', 'custom:WELDING & fabrication'])
  assert.deepEqual(await held(tx, 'cco_2'), ['roofing'])
  assert.deepEqual((await tx`select trade_types from contractor_companies where id = 'cco_1'`)[0].trade_types.length, 8, 'the old column is untouched')
})

await check('deleting a company takes its capabilities with it, and a retired entry that is held cannot be deleted', async (tx, w) => {
  await set(tx, w.boss, 'cco_1', [await cap(tx, 'welding')], ['x'])
  await rejects(tx, () => tx`delete from capabilities where code = 'welding'`, /violates foreign key/)
  await tx`delete from company_memberships where company_id = 'cco_1'`
  await tx`delete from client_company_links where company_id = 'cco_1'`
  await tx`delete from contractor_companies where id = 'cco_1'`
  assert.equal((await tx`select count(*)::int as n from company_capabilities where company_id = 'cco_1'`)[0].n, 0)
})

const failed = results.filter(([ok]) => !ok)
for (const [ok, name] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await sql.end()
process.exit(failed.length ? 1 : 0)
