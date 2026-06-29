'use server'

import { createHash } from 'node:crypto'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { inngest } from '@/lib/inngest/client'
import { generationJobApprove, generationJobStart } from '@/lib/inngest/events'
import { validateBlock } from '@/lib/renderer/validate'
import type { ContentModel, JobRecord, Quiz, RequalificationPolicy } from '@/contracts/types'

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

// ── Bounded quiz editor (contracts §7) ───────────────────────────────────────
// Validates the quiz client-side before the server action runs, then the server
// re-validates source_refs against the currently stored content model. Both
// coverage_map and question_count are recomputed from the question array so the
// approver cannot desync those derived fields.

function buildCoverageMap(questions: Quiz['questions']): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const q of questions) {
    if (!q.objective_id) continue
    if (!map[q.objective_id]) map[q.objective_id] = []
    map[q.objective_id].push(q.id)
  }
  return map
}

function validateQuizForSave(
  quiz: Quiz,
  blockIds: Set<string>,
): string[] {
  const errors: string[] = []
  const t = quiz.meta.pass_threshold
  if (typeof t !== 'number' || t <= 0 || t > 1) {
    errors.push('Pass threshold must be between 1% and 100%')
  }
  if (quiz.meta.attempts_allowed < 1) {
    errors.push('Attempts allowed must be at least 1')
  }
  if (quiz.questions.length === 0) {
    errors.push('Quiz must have at least one question')
  }
  quiz.questions.forEach((q, qi) => {
    const label = `Q${qi + 1}`
    if (!q.stem.trim()) errors.push(`${label}: stem is required`)
    if (q.options.length < 2) errors.push(`${label}: at least 2 options required`)
    if (q.correct_option_ids.length === 0) errors.push(`${label}: must have at least one correct answer`)
    const optIds = new Set(q.options.map((o) => o.id))
    for (const cid of q.correct_option_ids) {
      if (!optIds.has(cid)) errors.push(`${label}: correct answer "${cid}" is not a valid option`)
    }
    for (const ref of q.source_refs) {
      if (!blockIds.has(ref)) errors.push(`${label}: source_ref "${ref}" does not resolve to a block`)
    }
  })
  return errors
}

export async function saveQuizEdits(
  jobId: string,
  quiz: Quiz,
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
  if (!canEdit) return { error: 'Insufficient permissions to edit quiz' }

  if (!quiz || !Array.isArray(quiz.questions)) {
    return { error: 'Invalid quiz structure' }
  }

  // Fetch current content model from storage to resolve source_refs server-side
  const admin = createAdminClient()
  const storedArtifacts = job.artifacts as JobRecord['artifacts']
  const cmRef = storedArtifacts.content_model
  const blockIds = new Set<string>()
  if (cmRef) {
    const { data: blob, error: dlErr } = await admin.storage
      .from(ARTIFACTS_BUCKET)
      .download(cmRef.storage_key)
    if (!dlErr && blob) {
      const envelope = JSON.parse(await blob.text()) as { payload: ContentModel }
      for (const mod of envelope.payload.modules ?? []) {
        for (const blk of mod.blocks ?? []) {
          if (typeof blk.id === 'string') blockIds.add(blk.id)
        }
      }
    }
  }

  const errors = validateQuizForSave(quiz, blockIds)
  if (errors.length > 0) return { error: errors[0] }

  // Recompute derived fields and build human envelope
  const now = new Date().toISOString()
  const quizFinal: Quiz = {
    ...quiz,
    meta: { ...quiz.meta, question_count: quiz.questions.length },
    coverage_map: buildCoverageMap(quiz.questions),
  }
  const envelope = {
    job_id: jobId,
    stage: 'generating_quiz',
    attempt: 1,
    schema_version: '0.1',
    produced_at: now,
    produced_by: {
      kind: 'human',
      editor: user.id,
      stage_impl_version: 'generating_quiz@human-edit-1.0',
    },
    input_refs: {},
    payload: quizFinal,
  }

  const body = JSON.stringify(envelope, null, 2)
  const sha256 = createHash('sha256').update(body).digest('hex')
  const storageKey = `sites/${job.site_id}/jobs/${jobId}/artifacts/quiz.json`

  const { error: uploadErr } = await admin.storage
    .from(ARTIFACTS_BUCKET)
    .upload(storageKey, body, { contentType: 'application/json', upsert: true })
  if (uploadErr) return { error: uploadErr.message }

  const ref = { storage_key: storageKey, sha256, produced_at: now }
  const artifacts = { ...(job.artifacts as JobRecord['artifacts']), quiz: ref }

  const { error: updateErr } = await admin
    .from('generation_jobs')
    .update({ artifacts, updated_at: now })
    .eq('id', jobId)
  if (updateErr) return { error: updateErr.message }

  return {}
}

// ── Retry a failed or cancelled job (contracts §1 failed → retry) ─────────────
// Resets the job to queued and re-fires the start event, preserving existing
// source_asset and any artifacts already written. Never re-uploads the deck.
export async function retryJob(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const jobId = formData.get('job_id') as string | null
  if (!jobId) redirect('/app/sites?error=Job+ID+required')

  // RLS scopes this select to the caller's org — no cross-tenant reads possible.
  const { data: job } = await supabase
    .from('generation_jobs')
    .select('id, status, site_id, org_id')
    .eq('id', jobId)
    .maybeSingle()

  if (!job) redirect('/app/sites?error=Job+not+found')

  if (job.status !== 'failed' && job.status !== 'cancelled') {
    redirect(`/app/jobs/${jobId}?notice=Job+is+not+in+a+retryable+state`)
  }

  await supabase
    .from('generation_jobs')
    .update({ status: 'queued', current_stage: 'queued', error: null, updated_at: new Date().toISOString() })
    .eq('id', jobId)

  await inngest.send(
    generationJobStart.create({ jobId: job.id, siteId: job.site_id, orgId: job.org_id }),
  )

  redirect(`/app/jobs/${jobId}`)
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
