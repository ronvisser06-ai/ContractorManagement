// Checks drizzle/migrations/0018_crm_sync.sql (the queue's enqueue / claim / finish functions and who may reach them)
// against a SCRATCH Postgres. It applies the migration itself, so it refuses to run against anything that is not
// localhost: ConTrak's tests run against the production database (BUILDLOG 2026-09-30) and this must never.
//
//   createdb contrak_scratch    # a Postgres with the Supabase roles anon / authenticated / service_role
//   SCRATCH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/contrak_scratch node scripts/check-crm-sync-sql.mjs
//
// The roles need default privileges like Supabase's (grant all on new tables and execute on new functions to
// anon, authenticated, service_role): the migration's own REVOKEs are what is under test.

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import postgres from 'postgres'

const url = process.env.SCRATCH_DATABASE_URL
if (!url) throw new Error('Set SCRATCH_DATABASE_URL to a scratch database on localhost.')
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('Refusing: the scratch database must be on localhost.')

const sql = postgres(url, { max: 1, onnotice: () => {} })
const migration = readFileSync(new URL('../drizzle/migrations/0018_crm_sync.sql', import.meta.url), 'utf8')

// Start clean, functions included: CREATE OR REPLACE keeps a function's old grants, which would hide a missing REVOKE.
await sql.unsafe('drop function if exists enqueue_crm_sync(text, text, text, jsonb, text)')
await sql.unsafe('drop function if exists claim_crm_sync(integer, integer, boolean)')
await sql.unsafe('drop function if exists finish_crm_sync(text, text, text, integer, text, text, integer)')
await sql.unsafe('drop table if exists crm_sync cascade')
await sql.unsafe(migration)

const asRole = async (role, fn) => {
  await sql.unsafe(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await sql.unsafe('reset role')
  }
}
const refused = async (role, query) => {
  try {
    await asRole(role, () => sql.unsafe(query))
    return false
  } catch (e) {
    return /permission denied/.test(String(e.message))
  }
}
const enqueue = (id, hash, payload = { name: 'Apex' }) =>
  asRole('service_role', async () => (await sql`select enqueue_crm_sync('contractor_company', ${id}, 'company.upsert', ${sql.json(payload)}, ${hash}) as r`)[0].r)
const claim = async (limit = 10, dry = false) => [...(await asRole('service_role', () => sql`select * from claim_crm_sync(${limit}, 300, ${dry})`))]
const finish = (row, outcome, over = {}) =>
  asRole('service_role', () => sql`select finish_crm_sync(${row.id}, ${over.hash ?? row.payload_hash}, ${outcome}, ${over.status ?? null}, ${over.error ?? null}, ${over.remote ?? null}, ${over.delay ?? 0})`)
const one = async (id) => (await sql`select * from crm_sync where entity_id = ${id}`)[0]
const results = []
const check = async (name, fn) => {
  await sql`delete from crm_sync`
  try {
    await fn()
    results.push([true, name])
  } catch (e) {
    results.push([false, `${name}: ${e.message}`])
  }
}

await check('no browser role can read, write or call anything', async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.ok(await refused(role, 'select * from crm_sync'), `${role} select`)
    assert.ok(await refused(role, `insert into crm_sync (id, entity, entity_id, op, payload, payload_hash) values ('x','client_org','1','o','{}','h')`), `${role} insert`)
    assert.ok(await refused(role, `select enqueue_crm_sync('client_org','1','o','{}','h')`), `${role} enqueue`)
    assert.ok(await refused(role, 'select * from claim_crm_sync(5, 300, false)'), `${role} claim`)
    assert.ok(await refused(role, `select finish_crm_sync('x','h','delivered',200,null,null,0)`), `${role} finish`)
  }
})

await check('the table has row-level security on and no policy', async () => {
  const [t] = await sql`select relrowsecurity from pg_class where relname = 'crm_sync'`
  assert.equal(t.relrowsecurity, true)
  assert.equal((await sql`select 1 from pg_policies where tablename = 'crm_sync'`).length, 0)
})

await check('the same wanted state is not queued twice; a changed one is', async () => {
  assert.equal(await enqueue('a', 'h1'), 'queued')
  assert.equal(await enqueue('a', 'h1'), 'unchanged')
  assert.equal(await enqueue('a', 'h2', { name: 'Apex 2' }), 'queued')
  const r = await one('a')
  assert.equal(r.payload_hash, 'h2')
  assert.deepEqual(r.payload, { name: 'Apex 2' })
  assert.equal((await sql`select 1 from crm_sync`).length, 1)
})

await check('a delivered state stays delivered when queued again unchanged', async () => {
  await enqueue('a', 'h1')
  const [row] = await claim()
  await finish(row, 'delivered', { status: 201, remote: 'rc_1' })
  assert.equal(await enqueue('a', 'h1'), 'unchanged')
  const r = await one('a')
  assert.deepEqual([r.status, r.remote_id, r.delivered_hash], ['delivered', 'rc_1', 'h1'])
  assert.notEqual(r.delivered_at, null)
})

await check('claim takes a due row once, under a lease, counting the attempt', async () => {
  await enqueue('a', 'h1')
  const [row] = await claim()
  assert.equal(row.status, 'delivering')
  assert.equal(row.attempts, 1)
  assert.deepEqual(await claim(), [], 'leased: nobody else gets it')
})

await check('claim leaves out a row that is not due, respects the limit, and takes the one that has waited longest first', async () => {
  await enqueue('a', 'h1')
  await enqueue('b', 'h1')
  await enqueue('c', 'h1')
  // a has waited longest but was made earlier than b; created_at order must not decide.
  await sql`update crm_sync set next_attempt_at = now() + interval '1 hour' where entity_id = 'c'`
  await sql`update crm_sync set next_attempt_at = now() - interval '10 minutes', created_at = now() - interval '5 minutes' where entity_id = 'a'`
  await sql`update crm_sync set next_attempt_at = now() - interval '2 minutes', created_at = now() - interval '1 minute' where entity_id = 'b'`
  assert.deepEqual((await claim(1)).map((r) => r.entity_id), ['a'])
  assert.deepEqual((await claim(10)).map((r) => r.entity_id), ['b'])
})

await check('a lease that ran out is taken again, and that attempt counts', async () => {
  await enqueue('a', 'h1')
  await claim()
  await sql`update crm_sync set lease_until = now() - interval '1 second'`
  const [again] = await claim()
  assert.equal(again.attempts, 2)
})

await check('two workers claiming while the first is still working take different rows, and the second does not wait', async () => {
  for (const id of ['a', 'b', 'c', 'd']) await enqueue(id, 'h1')
  const other = postgres(url, { max: 1, onnotice: () => {} })
  try {
    const first = await sql.begin(async (tx) => {
      await tx.unsafe('set local role service_role')
      const mine = [...(await tx`select * from claim_crm_sync(2, 300, false)`)]
      // The first worker's transaction is still open (its rows are locked) when the second one claims.
      const theirs = await Promise.race([
        other.begin(async (tx2) => {
          await tx2.unsafe('set local role service_role')
          return [...(await tx2`select * from claim_crm_sync(2, 300, false)`)]
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('the second claim waited on the first worker\'s locks')), 5000)),
      ])
      return { mine, theirs }
    })
    const ids = [...first.mine, ...first.theirs].map((r) => r.entity_id)
    assert.equal(ids.length, 4)
    assert.equal(new Set(ids).size, 4)
  } finally {
    await other.end()
  }
})

await check('a retry waits, then comes due; a block does not use up the attempt', async () => {
  await enqueue('a', 'h1')
  const [row] = await claim()
  await finish(row, 'retry', { status: 503, error: 'down', delay: 60 })
  let r = await one('a')
  assert.deepEqual([r.status, r.attempts, r.last_status, r.last_error], ['pending', 1, 503, 'down'])
  assert.deepEqual(await claim(), [], 'not due yet')
  await sql`update crm_sync set next_attempt_at = now() - interval '1 second'`
  const [second] = await claim()
  await finish(second, 'blocked', { status: 401, error: 'key', delay: 900 })
  r = await one('a')
  assert.deepEqual([r.status, r.attempts], ['blocked', 1])
})

await check('abandoned is final: not claimed, and queueing the same state does not bring it back', async () => {
  await enqueue('a', 'h1')
  const [row] = await claim()
  await finish(row, 'abandoned', { status: 409, error: 'conflict' })
  assert.deepEqual(await claim(), [])
  assert.equal(await enqueue('a', 'h1'), 'unchanged')
  assert.equal((await one('a')).status, 'abandoned')
})

await check('a state that changed while it was being sent is not marked delivered by the old attempt', async () => {
  await enqueue('a', 'h1')
  const [old] = await claim()
  // The wanted state changes: the row goes back to pending, and a second worker takes it for the NEW state.
  assert.equal(await enqueue('a', 'h2'), 'queued')
  const [fresh] = await claim()
  assert.equal(fresh.payload_hash, 'h2')
  // The first worker now reports its outcome for the OLD state. It must not touch the row being delivered for the new one.
  await finish(old, 'delivered', { status: 201, remote: 'old' })
  const r = await one('a')
  assert.deepEqual([r.status, r.payload_hash, r.delivered_hash, r.remote_id], ['pending', 'h2', null, null])
  assert.equal(r.attempts, 0)
})

await check('a change while the old attempt is still out simply puts the row back to pending', async () => {
  await enqueue('a', 'h1')
  const [old] = await claim()
  assert.equal(await enqueue('a', 'h2'), 'queued')
  await finish(old, 'delivered', { status: 201, remote: 'old' })
  const r = await one('a')
  assert.deepEqual([r.status, r.delivered_hash], ['pending', null])
})

await check('an outcome for a row that is not being delivered changes nothing', async () => {
  await enqueue('a', 'h1')
  const r0 = await one('a')
  await finish(r0, 'delivered', { status: 201 })
  assert.equal((await one('a')).status, 'pending')
})

await check('a dry-run row is claimed again only when asked', async () => {
  await enqueue('a', 'h1')
  const [row] = await claim()
  await finish(row, 'dry_run', { error: 'Would send' })
  assert.deepEqual(await claim(5, false), [])
  assert.equal((await claim(5, true)).length, 1)
})

await check('an unknown outcome, an unknown entity and a long error are refused', async () => {
  await enqueue('a', 'h1')
  const [row] = await claim()
  await assert.rejects(finish(row, 'exploded'), /unknown outcome/)
  await assert.rejects(asRole('service_role', () => sql`select enqueue_crm_sync('worker','1','o','{}','h')`), /crm_sync_entity_check/)
  await finish(row, 'retry', { error: 'x'.repeat(900) })
  assert.equal((await one('a')).last_error.length, 500)
})

await sql.end()
for (const [ok, name] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
process.exit(results.every(([ok]) => ok) ? 0 : 1)
