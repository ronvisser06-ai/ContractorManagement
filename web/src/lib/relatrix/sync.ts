// The outbound sync engine (Relatrix-Integration-Brief.md §4). Pure logic over an injected Store, so it is tested
// without a database or a network. It never throws for a delivery problem: every outcome is recorded, so a failed sync
// is visible, retried or abandoned loudly, and never blocks the ConTrak action that queued it.

import { createHash } from 'node:crypto'
import { RelatrixError, type RelatrixClient } from './client.ts'
import type { SyncMode } from './config.ts'

export type Entity = 'contractor_company' | 'client_org' | 'client_company_link'

export interface SyncRow {
  id: string
  entity: Entity
  entity_id: string
  op: string
  payload: unknown
  payload_hash: string
  /** Counts this attempt. */
  attempts: number
}

export type Outcome =
  | { kind: 'delivered'; remoteId: string | null }
  | { kind: 'retry'; delaySeconds: number; status: number | null; error: string }
  | { kind: 'blocked'; delaySeconds: number; status: number | null; error: string }
  | { kind: 'abandoned'; status: number | null; error: string }
  | { kind: 'dry_run'; summary: string }

export interface Store {
  /** Queues the wanted state of one entity. `unchanged` means the same payload was already queued or delivered. */
  enqueue(entity: Entity, entityId: string, op: string, payload: unknown): Promise<'queued' | 'unchanged'>
  /** Takes up to `limit` due rows under a lease. A dry-run row is taken again only once the mode is live. */
  claim(limit: number, includeDryRun: boolean): Promise<SyncRow[]>
  finish(row: SyncRow, outcome: Outcome): Promise<void>
}

export interface Handler {
  /** What a dry run records instead of sending. */
  describe(payload: unknown): string
  run(payload: unknown, context: { client: RelatrixClient; idempotencyKey: string }): Promise<{ remoteId: string | null }>
}

/** A payload the handler cannot use. Resending it cannot help, so it is abandoned, not retried. */
export class InvalidPayload extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPayload'
  }
}

/** Seconds before the next try after this many attempts. Doubles, from half a minute to an hour. */
const BACKOFF = [30, 120, 600, 1800, 3600]
export const MAX_ATTEMPTS = 8
/** A key or scope problem is checked again every quarter of an hour and does not use up attempts. */
export const BLOCKED_RECHECK_SECONDS = 900

export const backoffSeconds = (attempts: number): number => BACKOFF[Math.min(Math.max(attempts, 1), BACKOFF.length) - 1]!

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** The same payload, however its keys are ordered, hashes the same. */
export const payloadHash = (payload: unknown): string => createHash('sha256').update(stable(payload)).digest('hex')

/**
 * Every attempt at one wanted state carries the same key, so Relatrix returns the first answer to a resend instead of
 * making a second record, and a changed state is a new key.
 */
export const idempotencyKey = (entity: string, entityId: string, op: string, hash: string): string =>
  `contrak-${entity}-${entityId}-${op}-${hash.slice(0, 16)}`

export interface DrainResult {
  delivered: number
  retried: number
  blocked: number
  abandoned: number
  dryRun: number
}

export interface DrainOptions {
  store: Store
  handlers: Record<string, Handler>
  mode: Exclude<SyncMode, 'off'>
  /** Not needed (and not built) in a dry run: nothing is sent. */
  client: RelatrixClient | null
  limit?: number
  maxAttempts?: number
}

const failure = (e: unknown): { status: number | null; error: string } =>
  e instanceof RelatrixError ? { status: e.status, error: e.message } : { status: null, error: 'Something unexpected went wrong.' }

export async function drain(options: DrainOptions): Promise<DrainResult> {
  const { store, handlers, mode, client } = options
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const result: DrainResult = { delivered: 0, retried: 0, blocked: 0, abandoned: 0, dryRun: 0 }

  const rows = await store.claim(options.limit ?? 20, mode === 'live')
  for (const row of rows) {
    let outcome: Outcome
    const handler = handlers[row.op]

    if (!handler) {
      outcome = { kind: 'abandoned', status: null, error: `There is no handler for “${row.op}”.` }
    } else if (mode === 'dry-run') {
      try {
        outcome = { kind: 'dry_run', summary: handler.describe(row.payload).slice(0, 500) }
      } catch (e) {
        outcome = { kind: 'abandoned', status: null, error: e instanceof InvalidPayload ? e.message : 'That payload could not be described.' }
      }
    } else if (!client) {
      // A live run with no client is a setup fault. Say so; do not spend an attempt on it.
      outcome = { kind: 'blocked', delaySeconds: BLOCKED_RECHECK_SECONDS, status: null, error: 'Relatrix is not configured.' }
    } else {
      try {
        const done = await handler.run(row.payload, { client, idempotencyKey: idempotencyKey(row.entity, row.entity_id, row.op, row.payload_hash) })
        outcome = { kind: 'delivered', remoteId: done.remoteId }
      } catch (e) {
        const { status, error } = failure(e)
        if (e instanceof InvalidPayload) outcome = { kind: 'abandoned', status: null, error: e.message }
        else if (e instanceof RelatrixError && e.kind === 'auth') outcome = { kind: 'blocked', delaySeconds: BLOCKED_RECHECK_SECONDS, status, error: `${error} Check the key and its scopes.` }
        else if (e instanceof RelatrixError && e.kind === 'refused') outcome = { kind: 'abandoned', status, error }
        else if (row.attempts >= maxAttempts) outcome = { kind: 'abandoned', status, error: `Gave up after ${row.attempts} attempts. ${error}` }
        else {
          const wait = e instanceof RelatrixError && e.retryAfterSeconds ? e.retryAfterSeconds : 0
          outcome = { kind: 'retry', delaySeconds: Math.max(backoffSeconds(row.attempts), wait), status, error }
        }
      }
    }

    await store.finish(row, outcome)
    if (outcome.kind === 'delivered') result.delivered += 1
    else if (outcome.kind === 'retry') result.retried += 1
    else if (outcome.kind === 'blocked') result.blocked += 1
    else if (outcome.kind === 'abandoned') result.abandoned += 1
    else result.dryRun += 1
  }
  return result
}
