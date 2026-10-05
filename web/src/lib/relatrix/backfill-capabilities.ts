// Backfill for what contractor companies do (Relatrix-Integration-Brief.md, slice S6, the part S5 unblocked): queues what the
// live hooks would have queued for every company that already holds a capability, such as the trades companies typed
// before the capability catalog and F2 copied in. Same shape as backfill-links.ts: pure over a source and a Store, only
// queues, safe to run twice, oldest company first. A company with no capabilities has nothing to propose and is not queued.

import { capabilitiesPayload, type CapabilityFacts } from './capability-sync.ts'
import { parseCapabilities, type CapabilitiesPayload } from './ops.ts'
import { payloadHash, type Store } from './sync.ts'
import type { PlanOptions, PlanState } from './backfill.ts'

export interface CompanyCapabilityRow extends CapabilityFacts {
  createdAt: string
}

export interface CapabilitiesSource {
  companies(): Promise<CompanyCapabilityRow[]>
  /** The payload hash last queued for each company, by company id. */
  queued(): Promise<Map<string, string>>
}

export interface CapabilityPlanItem {
  companyId: string
  name: string
  payload: CapabilitiesPayload
  state: PlanState
}

export interface CapabilityPlan {
  items: CapabilityPlanItem[]
  skipped: { companyId: string; reason: string }[]
}

export async function buildCapabilityPlan(source: CapabilitiesSource, options: PlanOptions = {}): Promise<CapabilityPlan> {
  const [companies, queued] = await Promise.all([source.companies(), source.queued()])
  const only = options.only?.length ? new Set(options.only) : null
  const skip = new Set(options.skip ?? [])
  const plan: CapabilityPlan = { items: [], skipped: [] }
  const ordered = [...companies].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.companyId.localeCompare(b.companyId))
  for (const c of ordered) {
    if (only && !only.has(c.companyId)) continue
    if (skip.has(c.companyId)) {
      plan.skipped.push({ companyId: c.companyId, reason: 'skipped by request' })
      continue
    }
    if (c.held.length === 0) continue
    let payload: CapabilitiesPayload
    try {
      payload = parseCapabilities(capabilitiesPayload(c))
    } catch (e) {
      plan.skipped.push({ companyId: c.companyId, reason: e instanceof Error ? e.message : 'its data is not usable' })
      continue
    }
    const last = queued.get(c.companyId)
    plan.items.push({ companyId: c.companyId, name: payload.name, payload, state: last === undefined ? 'new' : last === payloadHash(payload) ? 'unchanged' : 'changed' })
  }
  return plan
}

export async function applyCapabilityPlan(plan: CapabilityPlan, store: Store, limit = Infinity): Promise<{ queued: number; unchanged: number }> {
  const result = { queued: 0, unchanged: 0 }
  for (const item of plan.items) {
    if (item.state === 'unchanged') {
      result.unchanged += 1
      continue
    }
    if (result.queued >= limit) continue
    const r = await store.enqueue('contractor_company', item.companyId, 'company.capabilities', item.payload)
    if (r === 'queued') result.queued += 1
    else result.unchanged += 1
  }
  return result
}

export function describeCapabilityPlan(plan: CapabilityPlan): string[] {
  const count = (s: PlanState) => plan.items.filter((i) => i.state === s).length
  const lines = [`${plan.items.length} compan${plan.items.length === 1 ? 'y' : 'ies'} with capabilities: ${count('new')} new, ${count('changed')} changed, ${count('unchanged')} already queued as they stand.`]
  if (plan.items.some((i) => i.state !== 'unchanged')) lines.push('Each is proposed to Relatrix for a person to accept or reject in Review; nothing is written to a company.')
  for (const i of plan.items.filter((x) => x.state !== 'unchanged')) lines.push(`  ${i.state === 'new' ? '+' : '~'} ${i.name} → ${i.payload.capabilities.map((c) => c.label).join(', ')} [${i.companyId}]`)
  for (const s of plan.skipped) lines.push(`  - skipped ${s.companyId}: ${s.reason}`)
  return lines
}
