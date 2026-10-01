// Backfill: sends Relatrix the client organizations that existed before the integration was switched on
// (Relatrix-Integration-Brief.md, slice S6). It QUEUES what the engine would have queued had the integration been on from
// the start; the engine (drain) does the sending, so every safeguard of the live path applies, and the dry-run mode
// of that engine is the preview.
//
// Pure over injected sources and a Store, so it is tested without a database. Safe to run twice and to stop halfway: it queues
// only what is new or has changed since it was last queued, in a stable order (oldest organization first).
//
// Contractor companies are not backfilled here. Whether a contractor company is a new Relatrix company or one Ron already has,
// and which client uses which, is decided by the match-before-create work (slice S4), which waits for ConTrak's F1.

import { orgLifecyclePayload, type OrgFacts } from './lifecycle.ts'
import { MILESTONE_STAGE, MILESTONES, parseOrgCustomer, type OrgCustomerPayload } from './ops.ts'
import { payloadHash, type Store } from './sync.ts'

export interface DatedRow {
  org_id: string
  /** The instant the thing was created, or published for a package. */
  at: string
}

/** Where the facts come from. The real one reads ConTrak's database (backfill-source.ts); tests pass arrays. */
export interface FactsSource {
  orgs(): Promise<OrgFacts[]>
  sites(): Promise<DatedRow[]>
  packages(): Promise<DatedRow[]>
  /** Company (contractor) invitations only: a worker invite is not "a contractor". */
  companyInvites(): Promise<DatedRow[]>
  /** The payload hash last queued for each organization, by organization id. */
  queued(): Promise<Map<string, string>>
}

export type PlanState = 'new' | 'changed' | 'unchanged'

export interface PlanItem {
  orgId: string
  name: string
  payload: OrgCustomerPayload
  state: PlanState
  /** The stage the deal would be in, by milestone order, for the report. */
  stage: string
}

export interface Plan {
  items: PlanItem[]
  skipped: { orgId: string; reason: string }[]
}

export interface PlanOptions {
  /** Only these organizations. */
  only?: string[]
  /** Never these organizations (test organizations, say). */
  skip?: string[]
}

const earliest = (rows: DatedRow[]): Map<string, string> => {
  const m = new Map<string, string>()
  for (const r of rows) {
    const t = Date.parse(r.at)
    if (Number.isNaN(t)) continue
    const cur = m.get(r.org_id)
    if (cur === undefined || t < Date.parse(cur)) m.set(r.org_id, r.at)
  }
  return m
}

export async function buildPlan(source: FactsSource, options: PlanOptions = {}): Promise<Plan> {
  const [orgs, sites, packages, invites, queued] = await Promise.all([source.orgs(), source.sites(), source.packages(), source.companyInvites(), source.queued()])
  const firstSite = earliest(sites)
  const firstPackage = earliest(packages)
  const firstInvite = earliest(invites)
  const only = options.only?.length ? new Set(options.only) : null
  const skip = new Set(options.skip ?? [])

  const plan: Plan = { items: [], skipped: [] }
  const ordered = [...orgs].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
  for (const org of ordered) {
    if (only && !only.has(org.id)) continue
    if (skip.has(org.id)) {
      plan.skipped.push({ orgId: org.id, reason: 'skipped by request' })
      continue
    }
    if (!org.name.trim()) {
      plan.skipped.push({ orgId: org.id, reason: 'it has no name' })
      continue
    }
    if (Number.isNaN(Date.parse(org.createdAt))) {
      plan.skipped.push({ orgId: org.id, reason: 'its created date is not a date' })
      continue
    }
    let payload: OrgCustomerPayload
    try {
      // The same shape and checks the handler will apply, so a payload the engine would abandon is caught here.
      payload = parseOrgCustomer(
        orgLifecyclePayload(org, { firstSite: firstSite.get(org.id) ?? null, firstPackage: firstPackage.get(org.id) ?? null, firstContractorInvite: firstInvite.get(org.id) ?? null }),
      )
    } catch (e) {
      plan.skipped.push({ orgId: org.id, reason: e instanceof Error ? e.message : 'its data is not usable' })
      continue
    }
    const last = queued.get(org.id)
    const furthest = MILESTONES.filter((m) => payload.milestones[m] !== undefined).at(-1)!
    plan.items.push({
      orgId: org.id,
      name: payload.name,
      payload,
      state: last === undefined ? 'new' : last === payloadHash(payload) ? 'unchanged' : 'changed',
      stage: MILESTONE_STAGE[furthest],
    })
  }
  return plan
}

export interface ApplyResult {
  queued: number
  unchanged: number
}

/** Queues what is new or changed, up to `limit`, oldest first. Anything already queued as it stands is left alone. */
export async function applyPlan(plan: Plan, store: Store, limit = Infinity): Promise<ApplyResult> {
  const result: ApplyResult = { queued: 0, unchanged: 0 }
  for (const item of plan.items) {
    if (item.state === 'unchanged') {
      result.unchanged += 1
      continue
    }
    if (result.queued >= limit) continue
    // The store decides again, so two runs at once, or one after a crash, cannot queue a state twice.
    const r = await store.enqueue('client_org', item.orgId, 'org.customer', item.payload)
    if (r === 'queued') result.queued += 1
    else result.unchanged += 1
  }
  return result
}

export function describePlan(plan: Plan): string[] {
  const count = (s: PlanState) => plan.items.filter((i) => i.state === s).length
  const lines = [`${plan.items.length} organization${plan.items.length === 1 ? '' : 's'}: ${count('new')} new, ${count('changed')} changed, ${count('unchanged')} already queued as they stand.`]
  const byStage = new Map<string, number>()
  for (const i of plan.items.filter((x) => x.state !== 'unchanged')) byStage.set(i.stage, (byStage.get(i.stage) ?? 0) + 1)
  if (byStage.size) lines.push(`To queue, by the stage the deal would start in: ${[...byStage].map(([s, n]) => `${s} ${n}`).join(', ')}.`)
  for (const i of plan.items.filter((x) => x.state !== 'unchanged')) lines.push(`  ${i.state === 'new' ? '+' : '~'} ${i.name} (${i.orgId}) → ${i.stage}`)
  for (const s of plan.skipped) lines.push(`  - skipped ${s.orgId}: ${s.reason}`)
  return lines
}

// ── command line ───────────────────────────────────────────────────────────

export interface Args {
  command: 'plan' | 'queue' | 'status'
  limit: number
  only: string[]
  skip: string[]
  yes: boolean
}

export function parseArgs(argv: string[]): Args | { error: string } {
  const args: Args = { command: 'plan', limit: Infinity, only: [], skip: [], yes: false }
  const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--queue') args.command = 'queue'
    else if (a === '--status') args.command = 'status'
    else if (a === '--yes') args.yes = true
    else if (a === '--limit' || a === '--only' || a === '--skip') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value.` }
      if (a === '--limit') {
        const n = Number(v)
        if (!Number.isInteger(n) || n < 1) return { error: '--limit must be a whole number of at least 1.' }
        args.limit = n
      } else if (a === '--only') args.only = list(v)
      else args.skip = list(v)
    } else return { error: `Unknown option ${a}. Use --queue, --status, --limit N, --only ids, --skip ids, --yes.` }
  }
  return args
}
