// What each kind of sync does against Relatrix. One handler per `op`; the engine (sync.ts) owns retries and
// outcomes, so a handler only does the work and throws RelatrixError or InvalidPayload.

import { CONTRAK_TAG, CONTRAK_SOURCE } from './constants.ts'
import { RelatrixError, type Company, type RelatrixClient } from './client.ts'
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

/**
 * Finds the Relatrix company ConTrak filed under `ref` = `id`, or makes it, flagged as from ConTrak. An existing one is
 * brought up to date without taking anything away: tags are added to, never replaced, and a source a person chose stays.
 */
export async function upsertFlaggedCompany(
  client: RelatrixClient,
  spec: { ref: 'contrak' | 'contrak_org'; id: string; name: string; domain?: string | undefined; tags: string[] },
  idempotencyKey: string,
): Promise<Company> {
  const tags = [CONTRAK_TAG, ...spec.tags]
  const existing = await client.findCompanyByExternalRef(spec.ref, spec.id)
  if (!existing) {
    return await client.createCompany(
      { name: spec.name, ...(spec.domain ? { domain: spec.domain } : {}), source: CONTRAK_SOURCE, tags, external_refs: { [spec.ref]: spec.id } },
      idempotencyKey,
    )
  }
  const wanted = Array.from(new Set([...existing.tags, ...tags]))
  const patch: { name?: string; source?: string; tags?: string[] } = {}
  if (existing.name !== spec.name) patch.name = spec.name
  if (existing.source === null) patch.source = CONTRAK_SOURCE
  if (wanted.length !== existing.tags.length) patch.tags = wanted
  return Object.keys(patch).length > 0 ? await client.updateCompany(existing.id, patch, idempotencyKey) : existing
}

/** A company ConTrak knows becomes (or updates) one Relatrix company, flagged as from ConTrak. */
export const companyUpsert: Handler = {
  describe(payload) {
    const p = parseCompanyUpsert(payload)
    return `Would create or update the Relatrix company “${p.name}” (ConTrak id ${p.contrak_id}), source ${CONTRAK_SOURCE}, tag ${CONTRAK_TAG}.`
  },

  async run(payload, { client, idempotencyKey }) {
    const p = parseCompanyUpsert(payload)
    const company = await upsertFlaggedCompany(client, { ref: 'contrak', id: p.contrak_id, name: p.name, domain: p.domain, tags: p.tags ?? [] }, idempotencyKey)
    return { remoteId: company.id }
  },
}

// ── a client organization: a company and a deal on "ConTrak customers" ────────────────────────────

/** Ron's pipeline for ConTrak's own customers (Relatrix-Integration-Brief.md D-1) and the stage each milestone puts a deal in (D-2). */
export const CUSTOMER_PIPELINE = 'ConTrak customers'
export const MILESTONES = ['signed_up', 'onboarding', 'live', 'adopting'] as const
export type Milestone = (typeof MILESTONES)[number]
export const MILESTONE_STAGE: Record<Milestone, string> = { signed_up: 'Signed up', onboarding: 'Onboarding', live: 'Live', adopting: 'Adopting' }
const MILESTONE_WORDS: Record<Milestone, string> = {
  signed_up: 'signed up to ConTrak',
  onboarding: 'added its first site',
  live: 'published its first orientation package',
  adopting: 'invited its first contractor',
}

export interface OrgCustomerPayload {
  contrak_org_id: string
  name: string
  /** When each milestone was first reached (ISO instants). `signed_up` is always there. */
  milestones: Partial<Record<Milestone, string>>
}

export function parseOrgCustomer(payload: unknown): OrgCustomerPayload {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (!p) throw new InvalidPayload('The payload is not an object.')
  const id = typeof p.contrak_org_id === 'string' && p.contrak_org_id.trim() && p.contrak_org_id.length <= 100 ? p.contrak_org_id.trim() : null
  const name = typeof p.name === 'string' && p.name.trim() && p.name.trim().length <= 190 ? p.name.trim() : null
  if (!id) throw new InvalidPayload('contrak_org_id is required.')
  if (!name) throw new InvalidPayload('name is required and at most 190 characters.')
  const ms = p.milestones && typeof p.milestones === 'object' && !Array.isArray(p.milestones) ? (p.milestones as Record<string, unknown>) : null
  if (!ms) throw new InvalidPayload('milestones is required.')
  const unknown = Object.keys(ms).filter((k) => !(MILESTONES as readonly string[]).includes(k))
  if (unknown.length) throw new InvalidPayload(`Unknown milestone: ${unknown.join(', ')}.`)
  const milestones: Partial<Record<Milestone, string>> = {}
  for (const m of MILESTONES) {
    const at = ms[m]
    if (at === undefined) continue
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw new InvalidPayload(`${m} must be a date and time.`)
    milestones[m] = new Date(at).toISOString()
  }
  if (!milestones.signed_up) throw new InvalidPayload('signed_up is required.')
  return { contrak_org_id: id, name, milestones }
}

const reached = (p: OrgCustomerPayload): Milestone[] => MILESTONES.filter((m) => p.milestones[m] !== undefined)

/**
 * A client organization becomes a Relatrix company (tagged client) and a deal on "ConTrak customers", and the deal
 * follows the organization through ConTrak.
 *
 * It never overrides a person. ConTrak remembers the stage it last put the deal in (external_refs.contrak_stage) and
 * moves the deal only while the deal is still there, only forward, and never a deal Ron has closed. If Ron moved it,
 * ConTrak writes its notes and leaves the stage alone.
 */
export const orgCustomer: Handler = {
  describe(payload) {
    const p = parseOrgCustomer(payload)
    const top = reached(p).at(-1)!
    return `Would create or update the Relatrix company “${p.name}” (ConTrak org ${p.contrak_org_id}) and its deal on “${CUSTOMER_PIPELINE}”, in ${MILESTONE_STAGE[top]} (reached: ${reached(p).map((m) => MILESTONE_STAGE[m]).join(', ')}).`
  },

  async run(payload, { client, idempotencyKey }) {
    const p = parseOrgCustomer(payload)
    const hit = reached(p)

    const pipeline = await client.findPipelineByName(CUSTOMER_PIPELINE)
    if (!pipeline) throw new RelatrixError('setup', `There is no pipeline called “${CUSTOMER_PIPELINE}” in Relatrix.`, null, 'no_pipeline', null)
    const stage = new Map(pipeline.stages.map((s) => [s.name.trim().toLowerCase(), s]))
    const missing = hit.map((m) => MILESTONE_STAGE[m]).filter((n) => !stage.has(n.toLowerCase()))
    if (missing.length) throw new RelatrixError('setup', `The pipeline “${CUSTOMER_PIPELINE}” has no stage called ${missing.map((n) => `“${n}”`).join(', ')}.`, null, 'no_stage', null)
    const byId = new Map(pipeline.stages.map((s) => [s.id, s]))

    // The furthest stage the organization has reached, by the pipeline's own order.
    const target = hit.map((m) => stage.get(MILESTONE_STAGE[m].toLowerCase())!).reduce((a, b) => (b.position > a.position ? b : a))

    const company = await upsertFlaggedCompany(client, { ref: 'contrak_org', id: p.contrak_org_id, name: p.name, tags: ['client'] }, `${idempotencyKey}-co`)

    let deal = await client.findDealByExternalRef('contrak_org', p.contrak_org_id)
    if (!deal) {
      deal = await client.createDeal(
        { pipeline_id: pipeline.id, stage_id: target.id, title: `${p.name} (ConTrak)`, currency: 'CAD', company_id: company.id, external_refs: { contrak_org: p.contrak_org_id, contrak_stage: target.id } },
        `${idempotencyKey}-deal`,
      )
    } else if (deal.closed_at === null) {
      const lastSet = deal.external_refs.contrak_stage
      const here = byId.get(deal.stage_id)
      // Still where ConTrak left it (or never moved by ConTrak), in this pipeline, and the target is further on.
      if ((lastSet === undefined || lastSet === deal.stage_id) && here && target.position > here.position) {
        await client.moveDeal(deal.id, target.id, `${idempotencyKey}-move-${target.id.slice(0, 8)}`)
        await client.updateDeal(deal.id, { external_refs: { ...deal.external_refs, contrak_stage: target.id } }, `${idempotencyKey}-ref-${target.id.slice(0, 8)}`)
      }
    }

    // One note per milestone, keyed by the milestone and not by this payload, so a later milestone never repeats an earlier note.
    for (const m of hit) {
      await client.createActivity(
        { kind: 'note', subject: `ConTrak: ${MILESTONE_WORDS[m]}`, body: `${p.name} ${MILESTONE_WORDS[m]}.`, occurred_at: p.milestones[m]!, company_id: company.id, deal_id: deal.id },
        `contrak-org-${p.contrak_org_id}-ms-${m}`,
      )
    }
    return { remoteId: deal.id }
  },
}

export const handlers: Record<string, Handler> = { 'company.upsert': companyUpsert, 'org.customer': orgCustomer }
