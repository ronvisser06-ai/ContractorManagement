// Queues an organization's lifecycle for Relatrix. Called from the four places a milestone can be reached.
//
// It NEVER throws and never waits on Relatrix: the ConTrak action that called it has already succeeded, and a failure here
// (the queue table not migrated yet, the database busy) must not turn that into an error for the person who did it.
// The message is logged without anything but the organization's id.

import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from '@/lib/inngest/client'
import { orgLifecyclePayload } from './lifecycle'
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
      // A contractor company invite; worker invites are not "a contractor".
      supabase.from('invitations').select('created_at').eq('org_id', orgId).eq('type', 'company').order('created_at', { ascending: true }).limit(1),
    ])
    if (invite.error) throw new Error(invite.error.message)

    const payload = orgLifecyclePayload(
      { id: org.id as string, name: org.name as string, createdAt: org.created_at as string },
      { firstSite, firstPackage, firstContractorInvite: (invite.data?.[0]?.created_at as string | undefined) ?? null },
    )
    const result = await databaseStore().enqueue('client_org', orgId, 'org.customer', payload)
    // Wake the drain rather than wait for the next minute. Best effort: the schedule covers a lost event.
    if (result === 'queued') await inngest.send({ name: 'crm/sync.requested', data: {} }).catch(() => undefined)
    return true
  } catch (e) {
    console.error(`[relatrix] could not queue org ${orgId}:`, e instanceof Error ? e.message : 'unknown error')
    return false
  }
}
