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

// ── a contractor company, and who uses it ─────────────────────────────────────────────────────────

/** The relationship type Ron creates in Relatrix (Settings → Relationship types). The API cannot create one, so a missing type blocks the sync. */
export const USES_CONTRACTOR = 'uses-contractor'

/**
 * Finds the Relatrix company for a ConTrak contractor, in this order: filed under its ConTrak id, then by website domain,
 * then by name. Only when none matches is a company made, flagged as from ConTrak.
 *
 * A company that already existed is Ron's. It is adopted, not changed: ConTrak adds its tag and files its id, and leaves the
 * name, the source and everything else alone. If Relatrix already holds a different ConTrak id for it (two ConTrak records for one
 * real company), that stays and this one shares it, so both reach the same company.
 */
export async function matchOrCreateCompany(
  client: RelatrixClient,
  spec: { id: string; name: string; domain?: string | undefined },
  idempotencyKey: string,
): Promise<Company> {
  const filed = await client.findCompanyByExternalRef('contrak', spec.id)
  if (filed) return await upsertFlaggedCompany(client, { ref: 'contrak', id: spec.id, name: spec.name, domain: spec.domain, tags: ['contractor'] }, idempotencyKey)

  const one = (found: Company[], what: string): Company | null => {
    if (found.length > 1) throw new RelatrixError('setup', `More than one Relatrix company has ${what}: merge them in Relatrix, and the sync will carry on.`, null, 'ambiguous', null)
    return found[0] ?? null
  }
  const match = (spec.domain ? one(await client.findCompaniesByDomain(spec.domain), `the domain ${spec.domain}`) : null) ?? one(await client.findCompaniesByName(spec.name), `the name “${spec.name}”`)

  if (!match) {
    return await client.createCompany(
      { name: spec.name, ...(spec.domain ? { domain: spec.domain } : {}), source: CONTRAK_SOURCE, tags: [CONTRAK_TAG, 'contractor'], external_refs: { contrak: spec.id } },
      idempotencyKey,
    )
  }
  const tags = Array.from(new Set([...match.tags, CONTRAK_TAG, 'contractor']))
  const patch: { tags?: string[]; external_refs?: Record<string, string> } = {}
  if (tags.length !== match.tags.length) patch.tags = tags
  if (match.external_refs.contrak === undefined) patch.external_refs = { ...match.external_refs, contrak: spec.id }
  return Object.keys(patch).length > 0 ? await client.updateCompany(match.id, patch, idempotencyKey) : match
}

export interface LinkUsesPayload {
  contrak_link_id: string
  status: 'invited' | 'active' | 'suspended'
  since?: string
  org: { id: string; name: string }
  company: { id: string; name: string; domain?: string }
}

export function parseLinkUses(payload: unknown): LinkUsesPayload {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (!p) throw new InvalidPayload('The payload is not an object.')
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)
  const linkId = text(p.contrak_link_id, 100)
  if (!linkId) throw new InvalidPayload('contrak_link_id is required.')
  if (p.status !== 'invited' && p.status !== 'active' && p.status !== 'suspended') throw new InvalidPayload('status must be invited, active or suspended.')
  const side = (v: unknown, what: string, domain: boolean) => {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    const id = o && text(o.id, 100)
    const name = o && text(o.name, 190)
    if (!o || !id || !name) throw new InvalidPayload(`${what} needs an id and a name of at most 190 characters.`)
    const out: { id: string; name: string; domain?: string } = { id, name }
    if (domain && o.domain !== undefined) {
      const d = text(o.domain, 253)
      if (!d) throw new InvalidPayload('domain must be text of at most 253 characters.')
      out.domain = d
    }
    return out
  }
  const out: LinkUsesPayload = { contrak_link_id: linkId, status: p.status, org: side(p.org, 'org', false), company: side(p.company, 'company', true) }
  if (p.since !== undefined) {
    if (typeof p.since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.since)) throw new InvalidPayload('since must be a date, YYYY-MM-DD.')
    out.since = p.since
  }
  return out
}

/**
 * A client organization uses a contractor company. Both companies are found or made first (so this never waits on another
 * sync), then one "Uses contractor" edge runs from the organization's company to the contractor's: made once when the link
 * is active, ended (never deleted) when it is not, and brought back if the link is. An invited link makes no edge, because
 * nothing is used yet; the contractor company is still known.
 */
export const linkUses: Handler = {
  describe(payload) {
    const p = parseLinkUses(payload)
    return `Would make sure “${p.company.name}” (ConTrak ${p.company.id}) and “${p.org.name}” (ConTrak org ${p.org.id}) are in Relatrix, matching an existing company by id, domain or name first, and ${p.status === 'active' ? 'record that the organization uses it' : 'leave the “Uses contractor” edge ended or absent (link is ' + p.status + ')'}.`
  },

  async run(payload, { client, idempotencyKey }) {
    const p = parseLinkUses(payload)
    const type = await client.findRelationshipType(USES_CONTRACTOR)
    if (!type || type.retired_at) throw new RelatrixError('setup', 'Relatrix has no active relationship type “Uses contractor” (code uses-contractor). Create it in Settings → Relationship types, from a company to a company.', null, 'no_type', null)
    if (type.from_kind !== 'company' || type.to_kind !== 'company') throw new RelatrixError('setup', 'The relationship type “Uses contractor” must run from a company to a company.', null, 'bad_type', null)

    const orgCompany = await upsertFlaggedCompany(client, { ref: 'contrak_org', id: p.org.id, name: p.org.name, tags: ['client'] }, `${idempotencyKey}-org`)
    const contractor = await matchOrCreateCompany(client, { id: p.company.id, name: p.company.name, domain: p.company.domain }, `${idempotencyKey}-co`)

    const edge = (await client.findRelationships(USES_CONTRACTOR, orgCompany.id)).find((r) => r.from_company_id === orgCompany.id && r.to_company_id === contractor.id)
    const today = new Date().toISOString().slice(0, 10)
    if (p.status === 'active') {
      if (!edge) await client.createRelationship({ type: USES_CONTRACTOR, from_company_id: orgCompany.id, to_company_id: contractor.id, ...(p.since ? { started_on: p.since } : {}) }, `${idempotencyKey}-edge`)
      else if (edge.ended_on) await client.updateRelationship(edge.id, { ended_on: null }, `${idempotencyKey}-edge-on`)
    } else if (edge && !edge.ended_on) {
      await client.updateRelationship(edge.id, { ended_on: today }, `${idempotencyKey}-edge-off`)
    }
    return { remoteId: contractor.id }
  },
}

export const handlers: Record<string, Handler> = { 'company.upsert': companyUpsert, 'org.customer': orgCustomer, 'link.uses': linkUses }
