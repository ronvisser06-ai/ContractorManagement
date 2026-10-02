// Queues what ConTrak wants Relatrix to know: an organization's lifecycle (called from the places a milestone can be reached)
// and a client → contractor link (called wherever a link is made or changes).
//
// It NEVER throws and never waits on Relatrix: the ConTrak action that called it has already succeeded, and a failure here
// (the queue table not migrated yet, the database busy) must not turn that into an error for the person who did it.
// The message is logged without anything but the organization's id.

import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from '@/lib/inngest/client'
import { orgLifecyclePayload } from './lifecycle'
import { linkPayload, type LinkStatus } from './links'
import { databaseStore } from './store'

async function first(table: string, column: string, org: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from(table).select(column).eq('org_id', org).order(column, { ascending: true }).limit(1)
  if (error) throw new Error(error.message)
  const row = (data as unknown as Record<string, string>[] | null)?.[0]
  return row ? row[column] ?? null : null
}

export async function queueOrgLifecycle(orgId: string): Promise<boolean> {
  try {
    const supabase = createAdminClient()
    const { data: org, error } = await supabase.from('organizations').select('id, name, created_at').eq('id', orgId).maybeSingle()
    if (error || !org) throw new Error(error?.message ?? 'organization not found')

    const [firstSite, firstPackage, invite] = await Promise.all([
      first('sites', 'created_at', orgId),
      first('orientation_packages', 'published_at', orgId),
      // A contractor company brought in, by an email invite, by defining it, or by linking to one: all make a link.
      // Worker invites are not "a contractor".
      supabase.from('client_company_links').select('invited_at').eq('org_id', orgId).order('invited_at', { ascending: true }).limit(1),
    ])
    if (invite.error) throw new Error(invite.error.message)

    const payload = orgLifecyclePayload(
      { id: org.id as string, name: org.name as string, createdAt: org.created_at as string },
      { firstSite, firstPackage, firstContractorInvite: (invite.data?.[0]?.invited_at as string | undefined) ?? null },
    )
    const result = await databaseStore(supabase).enqueue('client_org', orgId, 'org.customer', payload)
    // Wake the drain rather than wait for the next minute. Best effort: the schedule covers a lost event.
    if (result === 'queued') await inngest.send({ name: 'crm/sync.requested', data: {} }).catch(() => undefined)
    return true
  } catch (e) {
    console.error(`[relatrix] could not queue org ${orgId}:`, e instanceof Error ? e.message : 'unknown error')
    return false
  }
}

// ── a client → contractor link ─────────────────────────────────────────────────────────────────────

interface LinkRow {
  id: string
  status: LinkStatus
  accepted_at: string | null
  organizations: { id: string; name: string } | null
  contractor_companies: { id: string; legal_name: string; contact_email: string | null } | null
}

const LINK_SELECT = 'id, status, accepted_at, organizations(id, name), contractor_companies(id, legal_name, contact_email)'

async function queueLinks(column: 'id' | 'company_id', value: string, what: string): Promise<boolean> {
  try {
    const supabase = createAdminClient()
    const { data, error } = (await supabase.from('client_company_links').select(LINK_SELECT).eq(column, value)) as unknown as { data: LinkRow[] | null; error: { message: string } | null }
    if (error) throw new Error(error.message)
    const store = databaseStore(supabase)
    let queued = 0
    for (const l of data ?? []) {
      if (!l.organizations || !l.contractor_companies) continue
      const payload = linkPayload({
        linkId: l.id,
        status: l.status,
        acceptedAt: l.accepted_at,
        org: { id: l.organizations.id, name: l.organizations.name },
        company: { id: l.contractor_companies.id, legalName: l.contractor_companies.legal_name, contactEmail: l.contractor_companies.contact_email },
      })
      if ((await store.enqueue('client_company_link', l.id, 'link.uses', payload)) === 'queued') queued += 1
    }
    if (queued > 0) await inngest.send({ name: 'crm/sync.requested', data: {} }).catch(() => undefined)
    return true
  } catch (e) {
    console.error(`[relatrix] could not queue ${what}:`, e instanceof Error ? e.message : 'unknown error')
    return false
  }
}

/** One link, after it was made or its status changed. Never throws. */
export const queueLink = (linkId: string) => queueLinks('id', linkId, `link ${linkId}`)

/** Every link of a company, after the company's own details changed or it gained an admin. Never throws. */
export const queueCompanyLinks = (companyId: string) => queueLinks('company_id', companyId, `links of company ${companyId}`)
