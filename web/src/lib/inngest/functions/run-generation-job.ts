import { createHash } from 'node:crypto'
import { inngest } from '../client'
import { generationJobStart } from '../events'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ArtifactRef, JobRecord, QAHistoryEntry, SourceAsset } from '@/contracts/types'

const ARTIFACTS_BUCKET = 'pipeline-artifacts'
const SIGNED_URL_TTL_SECONDS = 300

// Stages still stubbed (Step 3 only replaces extracting). Each maps to the
// artifact slot it fills in JobRecord.artifacts (contracts §2). qa_review has
// no artifact slot of its own — its verdict goes into qa_history instead.
const STUBBED_STAGES: { stage: 'structuring' | 'generating_quiz'; artifactKey: keyof JobRecord['artifacts'] }[] = [
  { stage: 'structuring', artifactKey: 'content_model' },
  { stage: 'generating_quiz', artifactKey: 'quiz' },
]

function buildEnvelope(
  jobId: string,
  stage: string,
  payload: Record<string, unknown>,
  options?: { stageImplVersion?: string; inputRefs?: Record<string, unknown> },
) {
  return {
    job_id: jobId,
    stage,
    attempt: 1,
    schema_version: '0.1',
    produced_at: new Date().toISOString(),
    produced_by: {
      kind: 'code' as const,
      // kind: "code" — extracting is a deterministic parse, not a model call
      // (contracts §3); the still-stubbed stages keep the @stub-0.1 marker.
      stage_impl_version: options?.stageImplVersion ?? `${stage}@stub-0.1`,
    },
    input_refs: options?.inputRefs ?? {},
    payload,
  }
}

async function storeArtifact(
  supabase: ReturnType<typeof createAdminClient>,
  jobId: string,
  siteId: string,
  artifactKey: keyof JobRecord['artifacts'],
  envelope: ReturnType<typeof buildEnvelope>,
) {
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
}

// Calls the standalone Python extractor service (Feature2-Pipeline-Skeleton-Brief.md
// Step 3) over HTTP with a short-lived signed URL to the uploaded deck — the
// extractor downloads the file itself rather than the deck's bytes flowing
// through this function.
async function callExtractor(supabase: ReturnType<typeof createAdminClient>, jobId: string, siteId: string) {
  const { data: job, error } = await supabase
    .from('generation_jobs')
    .select('source_asset')
    .eq('id', jobId)
    .single()
  if (error) throw error

  const sourceAsset = job.source_asset as SourceAsset
  const sourceType = sourceAsset.mime === 'application/pdf' ? 'pdf' : 'pptx'

  const { data: signed, error: signErr } = await supabase.storage
    .from(ARTIFACTS_BUCKET)
    .createSignedUrl(sourceAsset.storage_key, SIGNED_URL_TTL_SECONDS)
  if (signErr) throw signErr

  const response = await fetch(`${process.env.EXTRACTOR_URL}/extract`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.EXTRACTOR_SHARED_SECRET}`,
    },
    body: JSON.stringify({
      signed_url: signed.signedUrl,
      source_type: sourceType,
      job_id: jobId,
      site_id: siteId,
    }),
  })
  if (!response.ok) {
    throw new Error(`extractor service returned ${response.status}: ${await response.text()}`)
  }

  return { deck: (await response.json()) as Record<string, unknown>, sourceAsset }
}

// Walks a job through queued -> extracting -> structuring -> generating_quiz ->
// qa_review -> awaiting_approval (contracts §1). extracting is now a real
// deterministic parse (Step 3); structuring/generating_quiz/qa_review stay
// stubbed canned envelopes until M2.
export const runGenerationJob = inngest.createFunction(
  { id: 'run-generation-job', triggers: [generationJobStart] },
  async ({ event, step }) => {
    const { jobId, siteId } = event.data
    const supabase = createAdminClient()

    await step.run('enter-extracting', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({ status: 'extracting', current_stage: 'extracting', updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    })

    await step.run('produce-extracting', async () => {
      const { deck, sourceAsset } = await callExtractor(supabase, jobId, siteId)
      const envelope = buildEnvelope(jobId, 'extracting', deck, {
        stageImplVersion: 'extracting@real-0.1',
        inputRefs: { source_asset_sha256: sourceAsset.sha256 },
      })
      await storeArtifact(supabase, jobId, siteId, 'extracted_deck', envelope)
    })

    for (const { stage, artifactKey } of STUBBED_STAGES) {
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
        await storeArtifact(supabase, jobId, siteId, artifactKey, envelope)
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
