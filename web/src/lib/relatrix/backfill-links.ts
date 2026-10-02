// Backfill for client → contractor links (Relatrix-Integration-Brief.md, slice S6, the part S4 unblocked): queues what the
// live hooks would have queued for every link that existed before the integration was switched on. Same shape as the
// organization backfill (backfill.ts): pure over an injected source and a Store, only queues, safe to run twice, oldest first.
//
// The link handler finds or makes both companies itself, so this needs no order against the organization backfill.

import { linkPayload, type LinkFacts } from './links.ts'
import { parseLinkUses, type LinkUsesPayload } from './ops.ts'
import { payloadHash, type Store } from './sync.ts'
import type { PlanOptions, PlanState } from './backfill.ts'

export interface LinkRow extends LinkFacts {
  /** When the link was made, for the order. */
  invitedAt: string
}

export interface LinksSource {
  links(): Promise<LinkRow[]>
  /** The payload hash last queued for each link, by link id. */
  queued(): Promise<Map<string, string>>
}

export interface LinkPlanItem {
  linkId: string
  orgId: string
  orgName: string
  companyName: string
  payload: LinkUsesPayload
  state: PlanState
}

export interface LinkPlan {
  items: LinkPlanItem[]
  skipped: { linkId: string; reason: string }[]
}

/** `only` and `skip` name organizations or links: an organization id picks all its links. */
export async function buildLinkPlan(source: LinksSource, options: PlanOptions = {}): Promise<LinkPlan> {
  const [links, queued] = await Promise.all([source.links(), source.queued()])
  const only = options.only?.length ? new Set(options.only) : null
  const skip = new Set(options.skip ?? [])
  const named = (set: Set<string>, l: LinkRow) => set.has(l.linkId) || set.has(l.org.id)

  const plan: LinkPlan = { items: [], skipped: [] }
  const ordered = [...links].sort((a, b) => (Date.parse(a.invitedAt) || 0) - (Date.parse(b.invitedAt) || 0) || a.linkId.localeCompare(b.linkId))
  for (const l of ordered) {
    if (only && !named(only, l)) continue
    if (named(skip, l)) {
      plan.skipped.push({ linkId: l.linkId, reason: 'skipped by request' })
      continue
    }
    let payload: LinkUsesPayload
    try {
      // The checks the handler will apply, so a payload the engine would abandon is caught here with its reason.
      payload = parseLinkUses(linkPayload(l))
    } catch (e) {
      plan.skipped.push({ linkId: l.linkId, reason: e instanceof Error ? e.message : 'its data is not usable' })
      continue
    }
    const last = queued.get(l.linkId)
    plan.items.push({
      linkId: l.linkId,
      orgId: l.org.id,
      orgName: payload.org.name,
      companyName: payload.company.name,
      payload,
      state: last === undefined ? 'new' : last === payloadHash(payload) ? 'unchanged' : 'changed',
    })
  }
  return plan
}

export interface LinkApplyResult {
  queued: number
  unchanged: number
}

export async function applyLinkPlan(plan: LinkPlan, store: Store, limit = Infinity): Promise<LinkApplyResult> {
  const result: LinkApplyResult = { queued: 0, unchanged: 0 }
  for (const item of plan.items) {
    if (item.state === 'unchanged') {
      result.unchanged += 1
      continue
    }
    if (result.queued >= limit) continue
    // The store decides again, so two runs at once, or one after a crash, cannot queue a state twice.
    const r = await store.enqueue('client_company_link', item.linkId, 'link.uses', item.payload)
    if (r === 'queued') result.queued += 1
    else result.unchanged += 1
  }
  return result
}

export function describeLinkPlan(plan: LinkPlan): string[] {
  const count = (s: PlanState) => plan.items.filter((i) => i.state === s).length
  const lines = [`${plan.items.length} link${plan.items.length === 1 ? '' : 's'}: ${count('new')} new, ${count('changed')} changed, ${count('unchanged')} already queued as they stand.`]
  const byStatus = new Map<string, number>()
  for (const i of plan.items.filter((x) => x.state !== 'unchanged')) byStatus.set(i.payload.status, (byStatus.get(i.payload.status) ?? 0) + 1)
  if (byStatus.size) lines.push(`To queue, by link status: ${[...byStatus].map(([s, n]) => `${s} ${n}`).join(', ')}. Only active links get a "Uses contractor" edge.`)
  for (const i of plan.items.filter((x) => x.state !== 'unchanged')) lines.push(`  ${i.state === 'new' ? '+' : '~'} ${i.orgName} → ${i.companyName} (${i.payload.status}${i.payload.company.domain ? `, ${i.payload.company.domain}` : ''}) [${i.linkId}]`)
  for (const s of plan.skipped) lines.push(`  - skipped ${s.linkId}: ${s.reason}`)
  return lines
}
