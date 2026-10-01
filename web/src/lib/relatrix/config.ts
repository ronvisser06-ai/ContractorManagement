// Relatrix CRM connection settings (Relatrix-Integration-Brief.md §4).
//
// Pure: takes an env object, so it is tested without a server. The key is a server-side secret and is read
// only here and handed to the client; nothing in this folder ever puts it in a message, a log line or an error.

export type SyncMode = 'off' | 'dry-run' | 'live'

export interface RelatrixConfig {
  mode: SyncMode
  baseUrl: string
  apiKey: string
}

export type ConfigResult =
  | { ok: true; config: RelatrixConfig }
  | { ok: false; mode: 'off'; reason: string }
  | { ok: false; mode: SyncMode; reason: string }

const KEY = /^rlx_[0-9a-f]{64}$/

/**
 * RELATRIX_SYNC_MODE is `off` (the default: nothing is sent and nothing is claimed), `dry-run` (a sync is worked out and
 * recorded, never sent) or `live`. A deployment that has not been set up is therefore harmless.
 *
 * The address must be https and a bare origin. A key is only ever sent to the origin it was configured with, and
 * the client refuses redirects, so a wrong address cannot forward the key somewhere else.
 */
export function readConfig(env: Record<string, string | undefined>): ConfigResult {
  const raw = (env.RELATRIX_SYNC_MODE ?? 'off').trim().toLowerCase()
  if (raw !== 'off' && raw !== 'dry-run' && raw !== 'live') {
    return { ok: false, mode: 'off', reason: 'RELATRIX_SYNC_MODE must be off, dry-run or live.' }
  }
  const mode: SyncMode = raw
  if (mode === 'off') return { ok: false, mode: 'off', reason: 'Relatrix sync is off.' }

  let url: URL
  try {
    url = new URL((env.RELATRIX_BASE_URL ?? '').trim())
  } catch {
    return { ok: false, mode, reason: 'RELATRIX_BASE_URL is not a web address.' }
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  const secure = url.protocol === 'https:' || (local && url.protocol === 'http:' && env.RELATRIX_ALLOW_LOCAL === '1')
  if (!secure) return { ok: false, mode, reason: 'RELATRIX_BASE_URL must start with https://.' }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    return { ok: false, mode, reason: 'RELATRIX_BASE_URL must be only the site address, such as https://relatrixcrm.com.' }
  }

  const apiKey = (env.RELATRIX_API_KEY ?? '').trim()
  // A dry run never sends the key, so it may be left out; a live run may not.
  if (mode === 'live' && !KEY.test(apiKey)) {
    return { ok: false, mode, reason: 'RELATRIX_API_KEY is missing or is not a Relatrix key (rlx_ and 64 hex characters).' }
  }
  return { ok: true, config: { mode, baseUrl: url.origin, apiKey } }
}
