'use server'

import { createHash } from 'node:crypto'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from '@/lib/inngest/client'
import { generationJobApprove } from '@/lib/inngest/events'
import { validateBlock } from '@/lib/renderer/validate'
import type { ContentModel, JobRecord, RequalificationPolicy } from '@/contracts/types'

const ARTIFACTS_BUCKET = 'pipeline-artifacts'

// ── Bounded content-model editor (contracts §7) ───────────────────────────────
// Persists human-edited ContentModel as a new 'human' envelope, re-running the
// block validator server-side before writing. Only runs when job is
// awaiting_approval and caller holds an edit-capable role.
export async function saveContentModelEdits(
  jobId: string,
  contentModel: ContentModel,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: job } = await supabase
    .from('generation_jobs')
    .select('org_id, site_id, status, artifacts')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return { error: 'Job not found' }
  if (job.status !== 'awaiting_approval') return { error: 'Job is not awaiting approval' }

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('roles')
    .eq('user_id', user.id)
    .eq('org_id', job.org_id)
    .eq('status', 'active')
    .maybeSingle()
  const roles = (membership?.roles as string[] | undefined) ?? []
  const canEdit = roles.some((r) => ['content_developer', 'content_approver', 'client_admin'].includes(r))
  if (!canEdit) return { error: 'Insufficient permissions to edit content' }

  // Structural guard — modules must be present
  if (!contentModel || !Array.isArray(contentModel.modules)) {
    return { error: 'Invalid content model structure' }
  }

  // Validate every block with the same closed-set validator used by the renderer
  for (const mod of contentModel.modules) {
    for (let bi = 0; bi < mod.blocks.length; bi++) {
      const result = validateBlock(mod.blocks[bi], bi)
      if (result.error) {
        return {
          error: `Module "${mod.title}" › block ${bi + 1}: ${result.error.reason}`,
        }
      }
    }
  }

  // Build envelope with produced_by.kind='human' (contracts §3 + §7)
  const now = new Date().toISOString()
  const envelope = {
    job_id: jobId,
    stage: 'structuring',
    attempt: 1,
    schema_version: '0.1',
    produced_at: now,
    produced_by: {
      kind: 'human',
      editor: user.id,
      stage_impl_version: 'structuring@human-edit-1.0',
    },
    input_refs: {},
    payload: contentModel,
  }

  const body = JSON.stringify(envelope, null, 2)
  const sha256 = createHash('sha256').update(body).digest('hex')
  const storageKey = `sites/${job.site_id}/jobs/${jobId}/artifacts/content_model.json`

  const admin = createAdminClient()
  const { error: uploadErr } = await admin.storage
    .from(ARTIFACTS_BUCKET)
    .upload(storageKey, body, { contentType: 'application/json', upsert: true })
  if (uploadErr) return { error: uploadErr.message }

  const ref = { storage_key: storageKey, sha256, produced_at: now }
  const artifacts = { ...(job.artifacts as JobRecord['artifacts']), content_model: ref }

  const { error: updateErr } = await admin
    .from('generation_jobs')
    .update({ artifacts, updated_at: now })
    .eq('id', jobId)
  if (updateErr) return { error: updateErr.message }

  return {}
}

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
