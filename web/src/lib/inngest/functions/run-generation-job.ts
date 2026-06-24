import { createHash } from 'node:crypto'
import { inngest } from '../client'
import { generationJobStart } from '../events'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ArtifactRef, JobRecord, QAHistoryEntry } from '@/contracts/types'

const ARTIFACTS_BUCKET = 'pipeline-artifacts'

type WorkingStage = 'extracting' | 'structuring' | 'generating_quiz'

// Each stage maps to the artifact slot it fills in JobRecord.artifacts
// (contracts §2). qa_review has no artifact slot of its own — its verdict
// goes into qa_history instead (contracts §1 transition table).
const STAGES: { stage: WorkingStage; artifactKey: keyof JobRecord['artifacts'] }[] = [
  { stage: 'extracting', artifactKey: 'extracted_deck' },
  { stage: 'structuring', artifactKey: 'content_model' },
  { stage: 'generating_quiz', artifactKey: 'quiz' },
]

function buildEnvelope(jobId: string, stage: string, payload: Record<string, unknown>) {
  return {
    job_id: jobId,
    stage,
    attempt: 1,
    schema_version: '0.1',
    produced_at: new Date().toISOString(),
    // kind: "code" — these are deterministic stubs, not real model calls (contracts §3).
    produced_by: { kind: 'code' as const, stage_impl_version: `${stage}@stub-0.1` },
    input_refs: {},
    payload,
  }
}

// Walks a job through queued -> extracting -> structuring -> generating_quiz ->
// qa_review -> awaiting_approval (contracts §1). Every working stage here is a
// stub: canned envelope, canned artifact written to Storage, ref recorded on
// the job row. Real extract/structure/quiz/QA land in later steps/M2.
export const runGenerationJob = inngest.createFunction(
  { id: 'run-generation-job', triggers: [generationJobStart] },
  async ({ event, step }) => {
    const { jobId, siteId } = event.data
    const supabase = createAdminClient()

    for (const { stage, artifactKey } of STAGES) {
      await step.run(`enter-${stage}`, async () => {
        const { error } = await supabase
          .from('generation_jobs')
          .update({ status: stage, current_stage: stage, updated_at: new Date().toISOString() })
          .eq('id', jobId)
        if (error) throw error
      })

      await step.sleep(`pace-${stage}`, '2s')

      await step.run(`produce-${stage}`, async () => {
        const envelope = buildEnvelope(jobId, stage, {
          note: `stubbed ${stage} — canned envelope; the real implementation lands in a later step`,
        })
        const body = JSON.stringify(envelope, null, 2)
        const sha256 = createHash('sha256').update(body).digest('hex')
        const storageKey = `sites/${siteId}/jobs/${jobId}/artifacts/${artifactKey}.json`

        const { error: uploadErr } = await supabase.storage
          .from(ARTIFACTS_BUCKET)
          .upload(storageKey, body, { contentType: 'application/json', upsert: true })
        if (uploadErr) throw uploadErr

        const ref: ArtifactRef = { storage_key: storageKey, sha256, produced_at: envelope.produced_at }

        const { data: existing, error: fetchErr } = await supabase
          .from('generation_jobs')
          .select('artifacts')
          .eq('id', jobId)
          .single()
        if (fetchErr) throw fetchErr

        const artifacts = { ...(existing.artifacts as JobRecord['artifacts']), [artifactKey]: ref }

        const { error: updateErr } = await supabase
          .from('generation_jobs')
          .update({ artifacts, updated_at: new Date().toISOString() })
          .eq('id', jobId)
        if (updateErr) throw updateErr
      })
    }

    await step.run('enter-qa_review', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({ status: 'qa_review', current_stage: 'qa_review', updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    })

    await step.sleep('pace-qa_review', '2s')

    // Stub QA always passes — the rework loop (needs_rework, rework_count++) is
    // not exercised yet, but the columns/shape it needs already exist.
    await step.run('produce-qa_review', async () => {
      const verdictEntry: QAHistoryEntry = {
        attempt: 1,
        verdict: 'pass',
        routed_to: 'none',
        open_issue_count: 0,
        produced_at: new Date().toISOString(),
      }

      const { data: existing, error: fetchErr } = await supabase
        .from('generation_jobs')
        .select('qa_history')
        .eq('id', jobId)
        .single()
      if (fetchErr) throw fetchErr

      const qaHistory = [...(existing.qa_history as JobRecord['qa_history']), verdictEntry]

      const { error: updateErr } = await supabase
        .from('generation_jobs')
        .update({ qa_history: qaHistory, updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (updateErr) throw updateErr
    })

    await step.run('enter-awaiting_approval', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({
          status: 'awaiting_approval',
          current_stage: 'awaiting_approval',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
      if (error) throw error
    })

    return { jobId, status: 'awaiting_approval' as const }
  },
)
