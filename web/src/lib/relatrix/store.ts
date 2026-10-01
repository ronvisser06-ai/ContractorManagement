// The Store backed by ConTrak's database, through the three functions in migration 0018. Service role only: the table
// has no policy, so it takes the admin (service role) client, passed in: server-side workflows such as Inngest, and the
// backfill script. Never a browser. Imports are relative with extensions so a plain `node` script can load this file.

import type { SupabaseClient } from '@supabase/supabase-js'
import { payloadHash, type Entity, type Outcome, type Store, type SyncRow } from './sync.ts'

const LEASE_SECONDS = 300

interface ClaimedRow {
  id: string
  entity: Entity
  entity_id: string
  op: string
  payload: unknown
  payload_hash: string
  attempts: number
}

export function databaseStore(supabase: SupabaseClient): Store {

  return {
    async enqueue(entity, entityId, op, payload) {
      const { data, error } = await supabase.rpc('enqueue_crm_sync', {
        p_entity: entity,
        p_entity_id: entityId,
        p_op: op,
        p_payload: payload,
        p_hash: payloadHash(payload),
      })
      if (error) throw new Error(`Could not queue a Relatrix sync: ${error.message}`)
      return data === 'queued' ? 'queued' : 'unchanged'
    },

    async claim(limit, includeDryRun) {
      const { data, error } = await supabase.rpc('claim_crm_sync', { p_limit: limit, p_lease_seconds: LEASE_SECONDS, p_include_dry: includeDryRun })
      if (error) throw new Error(`Could not claim Relatrix syncs: ${error.message}`)
      return ((data ?? []) as ClaimedRow[]).map((r): SyncRow => ({
        id: r.id,
        entity: r.entity,
        entity_id: r.entity_id,
        op: r.op,
        payload: r.payload,
        payload_hash: r.payload_hash,
        attempts: r.attempts,
      }))
    },

    async finish(row, outcome: Outcome) {
      const p = {
        p_id: row.id,
        p_hash: row.payload_hash,
        p_outcome: outcome.kind === 'retry' ? 'retry' : outcome.kind,
        p_status: 'status' in outcome ? outcome.status : null,
        p_error: outcome.kind === 'dry_run' ? outcome.summary : 'error' in outcome ? outcome.error : null,
        p_remote: outcome.kind === 'delivered' ? outcome.remoteId : null,
        p_delay_seconds: 'delaySeconds' in outcome ? outcome.delaySeconds : 0,
      }
      const { error } = await supabase.rpc('finish_crm_sync', p)
      if (error) throw new Error(`Could not record a Relatrix sync outcome: ${error.message}`)
    },
  }
}
