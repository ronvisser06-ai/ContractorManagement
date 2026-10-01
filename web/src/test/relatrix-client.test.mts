import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRelatrixClient, classifyStatus, RelatrixError } from '../lib/relatrix/client.ts'
import { startFakeRelatrix, type FakeRelatrix } from './support/fake-relatrix.mts'

let fake: FakeRelatrix
before(async () => {
  fake = await startFakeRelatrix()
})
after(async () => {
  await fake.close()
})
beforeEach(() => fake.reset())

const client = (over: Partial<Parameters<typeof createRelatrixClient>[0]> = {}) => createRelatrixClient({ baseUrl: fake.url, apiKey: fake.key, ...over })
const fails = async (p: Promise<unknown>): Promise<RelatrixError> => {
  try {
    await p
  } catch (e) {
    assert.ok(e instanceof RelatrixError, `expected a RelatrixError, got ${String(e)}`)
    return e
  }
  assert.fail('expected a failure')
}

test('statuses are classified so the engine knows what resending can fix', () => {
  for (const s of [401, 403]) assert.equal(classifyStatus(s), 'auth', String(s))
  for (const s of [400, 404, 409, 410, 422]) assert.equal(classifyStatus(s), 'refused', String(s))
  for (const s of [408, 425, 429, 500, 502, 503, 504]) assert.equal(classifyStatus(s), 'transient', String(s))
})

test('health passes for a key that works', async () => {
  await client().health()
  assert.equal(fake.requests[0]!.authorization, `Bearer ${fake.key}`)
})

test('health fails as an auth problem for a wrong key, without saying the key', async () => {
  const e = await fails(client({ apiKey: `rlx_${'b'.repeat(64)}` }).health())
  assert.equal(e.kind, 'auth')
  assert.equal(e.status, 401)
  assert.equal(e.message.includes('rlx_'), false)
})

test('health refuses an address that answers but is not Relatrix', async () => {
  const e = await fails(client({ fetch: async () => new Response('<html>hello</html>', { status: 200 }) }).health())
  assert.equal(e.kind, 'refused')
  assert.match(e.message, /did not answer like Relatrix/)
})

test('a company is found by ConTrak’s id for it, and only by that', async () => {
  const c = client()
  const made = await c.createCompany({ name: 'Apex', source: 'contrak', tags: ['contrak'], external_refs: { contrak: 'co_1' } }, 'k1')
  await c.createCompany({ name: 'Birch', external_refs: { contrak: 'co_2' } }, 'k2')
  assert.equal((await c.findCompanyByExternalRef('contrak', 'co_1'))?.id, made.id)
  assert.equal(await c.findCompanyByExternalRef('contrak', 'co_9'), null)
  assert.equal(await c.findCompanyByExternalRef('planitize', 'co_1'), null)
})

test('an id with characters that mean something in a URL is sent as data, not as syntax', async () => {
  await client().findCompanyByExternalRef('contrak', 'a&limit=1000#x y')
  const url = fake.requests[0]!.url
  assert.ok(url.includes('external_ref%5Bcontrak%5D=a%26limit%3D1000%23x%20y'), url)
  assert.ok(!url.includes('limit=1000'))
})

test('two companies with one ConTrak id is a refusal, never a guess about which', async () => {
  const c = client()
  await c.createCompany({ name: 'A', external_refs: { contrak: 'dup' } }, 'k1')
  await c.createCompany({ name: 'B', external_refs: { contrak: 'dup' } }, 'k2')
  const e = await fails(c.findCompanyByExternalRef('contrak', 'dup'))
  assert.equal(e.kind, 'refused')
  assert.equal(e.code, 'ambiguous')
})

test('a write carries its idempotency key, and a resend makes no second company', async () => {
  const c = client()
  const first = await c.createCompany({ name: 'Apex' }, 'same-key')
  const again = await c.createCompany({ name: 'Apex' }, 'same-key')
  assert.equal(again.id, first.id)
  assert.equal(fake.companies.size, 1)
  assert.equal(fake.requests.at(-1)!.idempotencyKey, 'same-key')
})

test('a refusal carries Relatrix’s own sentence and is not worth resending', async () => {
  const c = client()
  await c.createCompany({ name: 'Apex' }, 'k1')
  const e = await fails(c.createCompany({ name: 'apex' }, 'k2'))
  assert.equal(e.kind, 'refused')
  assert.equal(e.status, 409)
  assert.equal(e.code, 'conflict')
  assert.match(e.message, /conflicts with a record that already exists/)
})

test('a server fault, a rate limit and a dropped connection are transient, and a limit says when to come back', async () => {
  fake.setFail([503])
  const a = await fails(client().health())
  assert.deepEqual([a.kind, a.status], ['transient', 503])
  fake.setFail([429])
  const b = await fails(client().health())
  assert.deepEqual([b.kind, b.status, b.retryAfterSeconds], ['transient', 429, 120])
  fake.setFail([0])
  const c = await fails(client().health())
  assert.deepEqual([c.kind, c.status], ['transient', null])
})

test('an answer that never comes times out as transient', async () => {
  fake.setFail([-1])
  const e = await fails(client({ timeoutMs: 100 }).health())
  assert.equal(e.kind, 'transient')
  assert.match(e.message, /did not answer in time/)
})

test('a redirect is refused, so the key cannot be forwarded to another address', async () => {
  let redirect: RequestRedirect | undefined
  const e = await fails(
    client({
      fetch: async (_url, init) => {
        redirect = init?.redirect
        // What the platform does with redirect: 'error' when the server answers with one.
        throw new TypeError('redirect mode is set to error')
      },
    }).health(),
  )
  assert.equal(redirect, 'error')
  assert.equal(e.kind, 'transient')
})

test('an error never contains the key, the address or the underlying message', async () => {
  const secret = `rlx_${'c'.repeat(64)}`
  const e = await fails(client({ apiKey: secret, fetch: async () => { throw new Error(`connect ECONNREFUSED ${fake.url} with ${secret}`) } }).health())
  assert.equal(JSON.stringify({ m: e.message, k: e.kind }).includes(secret), false)
  assert.equal(e.message.includes(fake.url), false)
  assert.equal(e.message.includes('ECONNREFUSED'), false)
})

test('a body that is not JSON does not become a crash', async () => {
  const e = await fails(client({ fetch: async () => new Response('Bad gateway', { status: 502 }) }).health())
  assert.deepEqual([e.kind, e.status], ['transient', 502])
  assert.match(e.message, /answered 502/)
})

test('a Relatrix message is capped, and nothing else from the response is shown', async () => {
  const e = await fails(client({ fetch: async () => new Response(JSON.stringify({ error: { code: 'x', message: 'y'.repeat(900) }, secret: 'leak' }), { status: 422 }) }).health())
  assert.equal(e.message.length, 200)
})
