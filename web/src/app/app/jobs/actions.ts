'use server'

import { createClient } from '@/lib/supabase/server'
import { newId } from '@/db/utils'
import { inngest } from '@/lib/inngest/client'
import { generationJobStart } from '@/lib/inngest/events'
import { redirect } from 'next/navigation'

export async function createJob(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const siteId = formData.get('site_id') as string | null
  if (!siteId) redirect('/app/sites?error=Site+is+required')

  // Org comes from the caller's own active membership — never trust a client-submitted org_id.
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) redirect('/onboarding/create-org')

  // Confirm the site actually belongs to the caller's org rather than trusting the form value.
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', siteId)
    .eq('org_id', membership.org_id)
    .maybeSingle()

  if (!site) redirect('/app/sites?error=Site+not+found')

  const jobId = newId('job_')

  // RLS ("generation_jobs: write if client_admin or content_developer") enforces
  // that only those roles in this org_id may actually insert.
  const { error } = await supabase.from('generation_jobs').insert({
    id: jobId,
    org_id: membership.org_id,
    site_id: siteId,
    created_by: user.id,
    // No real source asset yet (Step 3 brings uploads) — a stub key keeps each
    // triggered run unique rather than deduping by uploaded-asset hash.
    idempotency_key: `${siteId}:stub:${jobId}`,
  })

  if (error) {
    redirect(`/app/sites?error=${encodeURIComponent(error.message)}`)
  }

  await inngest.send(generationJobStart.create({ jobId, siteId, orgId: membership.org_id }))

  redirect(`/app/jobs/${jobId}`)
}
