// What each kind of sync does against Relatrix. One handler per `op`; the engine (sync.ts) owns retries and
// outcomes, so a handler only does the work and throws RelatrixError or InvalidPayload.

import { CONTRAK_TAG, CONTRAK_SOURCE } from './constants.ts'
import { InvalidPayload, type Handler } from './sync.ts'

export interface CompanyUpsertPayload {
  /** ConTrak's own id for the company: the key Relatrix files it under (external_refs.contrak). */
  contrak_id: string
  name: string
  domain?: string
  /** Tags beyond the ConTrak flag. */
  tags?: string[]
}

export function parseCompanyUpsert(payload: unknown): CompanyUpsertPayload {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (!p) throw new InvalidPayload('The payload is not an object.')
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)
  const contrakId = text(p.contrak_id, 100)
  const name = text(p.name, 200)
  if (!contrakId) throw new InvalidPayload('contrak_id is required.')
  if (!name) throw new InvalidPayload('name is required and at most 200 characters.')
  const out: CompanyUpsertPayload = { contrak_id: contrakId, name }
  if (p.domain !== undefined) {
    const domain = text(p.domain, 253)
    if (!domain) throw new InvalidPayload('domain must be text of at most 253 characters.')
    out.domain = domain
  }
  if (p.tags !== undefined) {
    if (!Array.isArray(p.tags) || p.tags.some((t) => typeof t !== 'string' || !t.trim() || t.trim().length > 40) || p.tags.length > 19) {
      throw new InvalidPayload('tags must be at most 19 labels of at most 40 characters.')
    }
    out.tags = (p.tags as string[]).map((t) => t.trim())
  }
  return out
}

/** A company ConTrak knows becomes (or updates) one Relatrix company, flagged as from ConTrak. */
export const companyUpsert: Handler = {
  describe(payload) {
    const p = parseCompanyUpsert(payload)
    return `Would create or update the Relatrix company “${p.name}” (ConTrak id ${p.contrak_id}), source ${CONTRAK_SOURCE}, tag ${CONTRAK_TAG}.`
  },

  async run(payload, { client, idempotencyKey }) {
    const p = parseCompanyUpsert(payload)
    const tags = [CONTRAK_TAG, ...(p.tags ?? [])]

    const existing = await client.findCompanyByExternalRef('contrak', p.contrak_id)
    if (!existing) {
      const created = await client.createCompany(
        { name: p.name, ...(p.domain ? { domain: p.domain } : {}), source: CONTRAK_SOURCE, tags, external_refs: { contrak: p.contrak_id } },
        idempotencyKey,
      )
      return { remoteId: created.id }
    }

    // It is already there. ConTrak keeps its own flag and name current and never takes away what a person set:
    // tags are added to, never replaced, and a source Ron chose is left alone.
    const wanted = Array.from(new Set([...existing.tags, ...tags]))
    const patch: { name?: string; source?: string; tags?: string[] } = {}
    if (existing.name !== p.name) patch.name = p.name
    if (existing.source === null) patch.source = CONTRAK_SOURCE
    if (wanted.length !== existing.tags.length) patch.tags = wanted
    if (Object.keys(patch).length > 0) await client.updateCompany(existing.id, patch, idempotencyKey)
    return { remoteId: existing.id }
  },
}

export const handlers: Record<string, Handler> = { 'company.upsert': companyUpsert }
