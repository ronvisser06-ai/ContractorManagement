// An in-memory Store with the same rules as the SQL functions in drizzle/migrations/0018_crm_sync.sql
// (enqueue / claim / finish), so the engine is tested without a database. The SQL itself is checked separately
// (BUILDLOG: run against a scratch Postgres, not ConTrak's production database).

import { payloadHash, type Entity, type Outcome, type Store, type SyncRow } from '../../lib/relatrix/sync.ts'

export interface MemoryRow extends SyncRow {
  status: 'pending' | 'delivering' | 'delivered' | 'blocked' | 'abandoned' | 'dry_run'
  next_attempt_at: number
  lease_until: number | null
  last_error: string | null
  last_status: number | null
  delivered_hash: string | null
  remote_id: string | null
}

export interface MemoryStore extends Store {
  rows: Map<string, MemoryRow>
  clock: { now: number }
  byEntity(entity: string, entityId: string): MemoryRow | undefined
}

export function memoryStore(leaseSeconds = 300): MemoryStore {
  const rows = new Map<string, MemoryRow>()
  const clock = { now: 1_000_000 }
  let n = 0
  const key = (e: string, id: string, op: string) => `${e}|${id}|${op}`

  return {
    rows,
    clock,
    byEntity: (entity, entityId) => [...rows.values()].find((r) => r.entity === entity && r.entity_id === entityId),

    async enqueue(entity: Entity, entityId, op, payload) {
      const hash = payloadHash(payload)
      const k = key(entity, entityId, op)
      const existing = rows.get(k)
      if (existing && existing.payload_hash === hash) return 'unchanged'
      n += 1
      rows.set(k, {
        id: existing?.id ?? `crm_${n}`,
        entity,
        entity_id: entityId,
        op,
        payload,
        payload_hash: hash,
        attempts: 0,
        status: 'pending',
        next_attempt_at: clock.now,
        lease_until: null,
        last_error: null,
        last_status: null,
        delivered_hash: existing?.delivered_hash ?? null,
        remote_id: existing?.remote_id ?? null,
      })
      return 'queued'
    },

    async claim(limit, includeDry) {
      const due = [...rows.values()]
        .filter((r) => r.next_attempt_at <= clock.now)
        .filter((r) => r.status === 'pending' || r.status === 'blocked' || (includeDry && r.status === 'dry_run') || (r.status === 'delivering' && (r.lease_until ?? 0) < clock.now))
        .sort((a, b) => a.next_attempt_at - b.next_attempt_at)
        .slice(0, limit)
      for (const r of due) {
        r.status = 'delivering'
        r.lease_until = clock.now + leaseSeconds
        r.attempts += 1
      }
      return due.map((r) => ({ ...r }))
    },

    async finish(row, outcome: Outcome) {
      const r = rows.get(key(row.entity, row.entity_id, row.op))
      if (!r || r.status !== 'delivering') return
      // The wanted state changed while it was being sent: it goes round again, whatever happened to the old one.
      if (r.payload_hash !== row.payload_hash) {
        r.status = 'pending'
        r.attempts = 0
        r.next_attempt_at = clock.now
        r.lease_until = null
        return
      }
      r.lease_until = null
      r.last_error = null
      r.last_status = null
      if (outcome.kind === 'delivered') {
        r.status = 'delivered'
        r.delivered_hash = row.payload_hash
        r.remote_id = outcome.remoteId
      } else if (outcome.kind === 'dry_run') {
        r.status = 'dry_run'
        r.last_error = outcome.summary
      } else if (outcome.kind === 'abandoned') {
        r.status = 'abandoned'
        r.last_error = outcome.error
        r.last_status = outcome.status
      } else if (outcome.kind === 'blocked') {
        r.status = 'blocked'
        r.attempts -= 1
        r.next_attempt_at = clock.now + outcome.delaySeconds
        r.last_error = outcome.error
        r.last_status = outcome.status
      } else {
        r.status = 'pending'
        r.next_attempt_at = clock.now + outcome.delaySeconds
        r.last_error = outcome.error
        r.last_status = outcome.status
      }
    },
  }
}
