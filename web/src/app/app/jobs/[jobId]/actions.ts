'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { inngest } from '@/lib/inngest/client'
import { generationJobApprove } from '@/lib/inngest/events'
import type { RequalificationPolicy } from '@/contracts/types'

const VALID_POLICIES: RequalificationPolicy[] = ['full', 'new_content_only', 'none']

export async function approveJob(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const jobId = formData.get('job_id') as string | null
  const policy = formData.get('requalification_policy') as string | null
  if (!jobId) redirect('/app/sites?error=Job+is+required')
  if (!policy || !VALID_POLICIES.includes(policy as RequalificationPolicy)) {
    redirect(`/app/jobs/${jobId}?error=Invalid+requalification+policy`)
  }

  const { data: job } = await supabase
    .from('generation_jobs')
    .select('id, org_id, site_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (!job) redirect('/app/sites?error=Job+not+found')
  if (job.status !== 'awaiting_approval') {
    redirect(`/app/jobs/${jobId}?error=Job+is+not+awaiting+approval`)
  }

  // The real gate: RLS on generation_jobs is broadened to client_admin/
  // content_developer/content_approver (so all three can write the row across
  // its lifecycle), so it alone can't enforce "only a content_approver may
  // approve." Check the precise role here instead of trusting the UI gate.
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('roles')
    .eq('user_id', user.id)
    .eq('org_id', job.org_id)
    .eq('status', 'active')
    .maybeSingle()

  const roles = (membership?.roles as string[] | undefined) ?? []
  if (!roles.includes('content_approver')) {
    redirect(`/app/jobs/${jobId}?error=Only+a+content+approver+can+approve+this+draft`)
  }

  const { error } = await supabase
    .from('generation_jobs')
    .update({
      status: 'publishing',
      current_stage: 'publishing',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    redirect(`/app/jobs/${jobId}?error=${encodeURIComponent(error.message)}`)
  }

  await inngest.send(
    generationJobApprove.create({
      jobId: job.id,
      siteId: job.site_id,
      orgId: job.org_id,
      approvedBy: user.id,
      requalificationPolicy: policy as RequalificationPolicy,
    }),
  )

  redirect(`/app/jobs/${jobId}`)
}
