// ConTrak's database as a backfill FactsSource, read with the admin (service role) client. Read-only.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DatedRow, FactsSource } from './backfill.ts'
import type { LinkRow, LinksSource } from './backfill-links.ts'
import type { CapabilitiesSource } from './backfill-capabilities.ts'

const PAGE = 1000

/** Every row of a table, in a stable order, a page at a time (the API returns at most 1000 rows). */
async function all<T>(supabase: SupabaseClient, table: string, columns: string, order: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).order(order, { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    out.push(...((data ?? []) as unknown as T[]))
    if (!data || data.length < PAGE) return out
  }
}

export function databaseSource(supabase: SupabaseClient): FactsSource {
  const dated = (rows: Record<string, string | null>[], column: string): DatedRow[] =>
    rows.filter((r) => r.org_id && r[column]).map((r) => ({ org_id: r.org_id as string, at: r[column] as string }))

  return {
    async orgs() {
      const rows = await all<{ id: string; name: string; created_at: string }>(supabase, 'organizations', 'id, name, created_at', 'created_at')
      return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }))
    },
    async sites() {
      return dated(await all<Record<string, string | null>>(supabase, 'sites', 'id, org_id, created_at', 'created_at'), 'created_at')
    },
    async packages() {
      return dated(await all<Record<string, string | null>>(supabase, 'orientation_packages', 'id, org_id, published_at', 'published_at'), 'published_at')
    },
    async companyInvites() {
      const rows: Record<string, string | null>[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('client_company_links').select('id, org_id, invited_at').order('invited_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1)
        if (error) throw new Error(`Could not read company links: ${error.message}`)
        rows.push(...((data ?? []) as Record<string, string | null>[]))
        if (!data || data.length < PAGE) break
      }
      return dated(rows, 'invited_at')
    },
    async queued() {
      const m = new Map<string, string>()
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('crm_sync').select('entity_id, payload_hash').eq('entity', 'client_org').eq('op', 'org.customer').order('entity_id', { ascending: true }).range(from, from + PAGE - 1)
        if (error) throw new Error(`Could not read the sync queue: ${error.message}`)
        for (const r of (data ?? []) as { entity_id: string; payload_hash: string }[]) m.set(r.entity_id, r.payload_hash)
        if (!data || data.length < PAGE) break
      }
      return m
    },
  }
}

interface LinkQueryRow {
  id: string
  status: 'invited' | 'active' | 'suspended'
  invited_at: string
  accepted_at: string | null
  organizations: { id: string; name: string } | null
  contractor_companies: { id: string; legal_name: string; contact_email: string | null } | null
}

/** Every client → contractor link, with both sides' names and the contractor's contact address (only its domain leaves). Read-only. */
export function databaseLinksSource(supabase: SupabaseClient): LinksSource {
  return {
    async links() {
      const out: LinkRow[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('client_company_links')
          .select('id, status, invited_at, accepted_at, organizations(id, name), contractor_companies(id, legal_name, contact_email)')
          .order('invited_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) throw new Error(`Could not read company links: ${error.message}`)
        for (const l of (data ?? []) as unknown as LinkQueryRow[]) {
          // A link whose organization or company cannot be read is reported by the plan, not guessed at.
          out.push({
            linkId: l.id,
            status: l.status,
            acceptedAt: l.accepted_at,
            invitedAt: l.invited_at,
            org: { id: l.organizations?.id ?? '', name: l.organizations?.name ?? '' },
            company: { id: l.contractor_companies?.id ?? '', legalName: l.contractor_companies?.legal_name ?? '', contactEmail: l.contractor_companies?.contact_email ?? null },
          })
        }
        if (!data || data.length < PAGE) return out
      }
    },
    async queued() {
      const m = new Map<string, string>()
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('crm_sync').select('entity_id, payload_hash').eq('entity', 'client_company_link').eq('op', 'link.uses').order('entity_id', { ascending: true }).range(from, from + PAGE - 1)
        if (error) throw new Error(`Could not read the sync queue: ${error.message}`)
        for (const r of (data ?? []) as { entity_id: string; payload_hash: string }[]) m.set(r.entity_id, r.payload_hash)
        if (!data || data.length < PAGE) break
      }
      return m
    },
  }
}

/** Every company that holds a capability, with the catalog entries and its own words. Read-only. */
export function databaseCapabilitiesSource(supabase: SupabaseClient): CapabilitiesSource {
  return {
    async companies() {
      const held = new Map<string, { code: string | null; label: string }[]>()
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('company_capabilities')
          .select('id, company_id, custom_label, capabilities(code, label)')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) throw new Error(`Could not read company capabilities: ${error.message}`)
        for (const r of (data ?? []) as unknown as { company_id: string; custom_label: string | null; capabilities: { code: string; label: string } | null }[]) {
          const list = held.get(r.company_id) ?? []
          list.push(r.capabilities ? { code: r.capabilities.code, label: r.capabilities.label } : { code: null, label: r.custom_label ?? '' })
          held.set(r.company_id, list)
        }
        if (!data || data.length < PAGE) break
      }
      const out: { companyId: string; legalName: string; contactEmail: string | null; held: { code: string | null; label: string }[]; createdAt: string }[] = []
      const ids = [...held.keys()]
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from('contractor_companies').select('id, legal_name, contact_email, created_at').in('id', ids.slice(i, i + 200))
        if (error) throw new Error(`Could not read companies: ${error.message}`)
        for (const c of (data ?? []) as { id: string; legal_name: string; contact_email: string | null; created_at: string }[]) {
          out.push({ companyId: c.id, legalName: c.legal_name, contactEmail: c.contact_email, held: held.get(c.id) ?? [], createdAt: c.created_at })
        }
      }
      return out
    },
    async queued() {
      const m = new Map<string, string>()
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('crm_sync').select('entity_id, payload_hash').eq('entity', 'contractor_company').eq('op', 'company.capabilities').order('entity_id', { ascending: true }).range(from, from + PAGE - 1)
        if (error) throw new Error(`Could not read the sync queue: ${error.message}`)
        for (const r of (data ?? []) as { entity_id: string; payload_hash: string }[]) m.set(r.entity_id, r.payload_hash)
        if (!data || data.length < PAGE) break
      }
      return m
    },
  }
}

export interface StatusLine {
  status: string
  count: number
}

/** How the queue stands: a count per status, and the most recent problems (what Ron needs to act on). */
export async function queueStatus(supabase: SupabaseClient): Promise<{ counts: StatusLine[]; problems: { entity_id: string; status: string; last_error: string | null; last_status: number | null }[] }> {
  const { data, error } = await supabase.from('crm_sync').select('entity_id, status, last_error, last_status, updated_at').order('updated_at', { ascending: false }).limit(5000)
  if (error) throw new Error(`Could not read the sync queue: ${error.message}`)
  const rows = (data ?? []) as { entity_id: string; status: string; last_error: string | null; last_status: number | null }[]
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
  return {
    counts: [...counts].map(([status, count]) => ({ status, count })).sort((a, b) => a.status.localeCompare(b.status)),
    problems: rows.filter((r) => r.status === 'blocked' || r.status === 'abandoned').slice(0, 20),
  }
}
