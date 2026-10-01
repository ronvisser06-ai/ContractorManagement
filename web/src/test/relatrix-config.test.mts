import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readConfig } from '../lib/relatrix/config.ts'

const KEY = `rlx_${'a'.repeat(64)}`
const live = { RELATRIX_SYNC_MODE: 'live', RELATRIX_BASE_URL: 'https://relatrixcrm.com', RELATRIX_API_KEY: KEY }

test('nothing is configured: sync is off, and that is not an error', () => {
  for (const env of [{}, { RELATRIX_SYNC_MODE: 'off' }, { RELATRIX_SYNC_MODE: ' OFF ' }]) {
    const r = readConfig(env)
    assert.equal(r.ok, false)
    assert.equal(r.mode, 'off')
  }
})

test('a mode that is not one of the three is refused, and treated as off', () => {
  const r = readConfig({ ...live, RELATRIX_SYNC_MODE: 'yes' })
  assert.equal(r.ok, false)
  assert.equal(r.mode, 'off')
  assert.match(r.reason, /off, dry-run or live/)
})

test('live with a good address and key is ready, with the address cut to its origin', () => {
  const r = readConfig({ ...live, RELATRIX_BASE_URL: ' https://RelatrixCRM.com/ ' })
  assert.deepEqual(r, { ok: true, config: { mode: 'live', baseUrl: 'https://relatrixcrm.com', apiKey: KEY } })
})

test('the address must be https, a bare origin, and a web address at all', () => {
  for (const url of ['http://relatrixcrm.com', 'ftp://relatrixcrm.com', 'relatrixcrm.com', '', 'https://user:pw@relatrixcrm.com', 'https://relatrixcrm.com/api', 'https://relatrixcrm.com/?x=1', 'https://relatrixcrm.com/#x']) {
    const r = readConfig({ ...live, RELATRIX_BASE_URL: url })
    assert.equal(r.ok, false, url)
  }
})

test('plain http is allowed only for localhost and only when asked for, so tests can run a fake', () => {
  assert.equal(readConfig({ ...live, RELATRIX_BASE_URL: 'http://127.0.0.1:4000' }).ok, false)
  assert.equal(readConfig({ ...live, RELATRIX_BASE_URL: 'http://127.0.0.1:4000', RELATRIX_ALLOW_LOCAL: '1' }).ok, true)
  assert.equal(readConfig({ ...live, RELATRIX_BASE_URL: 'http://relatrixcrm.com', RELATRIX_ALLOW_LOCAL: '1' }).ok, false)
})

test('a live run needs a real key; a dry run never sends it, so it may be left out', () => {
  for (const key of ['', 'nonsense', 'rlx_short', `rlx_${'G'.repeat(64)}`]) assert.equal(readConfig({ ...live, RELATRIX_API_KEY: key }).ok, false, key)
  assert.equal(readConfig({ ...live, RELATRIX_SYNC_MODE: 'dry-run', RELATRIX_API_KEY: '' }).ok, true)
})

test('a refusal never contains the key', () => {
  const r = readConfig({ ...live, RELATRIX_BASE_URL: 'nope' })
  assert.equal(r.ok, false)
  assert.equal(JSON.stringify(r).includes(KEY), false)
})
