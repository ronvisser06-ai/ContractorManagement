import { createHash } from 'node:crypto'
import { inngest } from '../client'
import { generationJobStart } from '../events'
import { createAdminClient } from '@/lib/supabase/admin'
import { callStructure, STRUCTURE_MODEL, STRUCTURE_STAGE_VERSION } from '@/lib/pipeline/structure'
import type { ArtifactRef, JobRecord, QAHistoryEntry, SourceAsset } from '@/contracts/types'

const ARTIFACTS_BUCKET = 'pipeline-artifacts'
const SIGNED_URL_TTL_SECONDS = 300

// Canned Quiz for the still-stubbed generating_quiz stage (real AI quiz is M2 Step 2).
// Cites blk_stub_03 from the old canned model — once the real structure stage runs,
// the quiz stub's source_refs won't align, but the orchestration flow still proves out.
function buildCannedQuiz(): Record<string, unknown> {
  return {
    meta: { pass_threshold: 0.8, attempts_allowed: 3, shuffle_questions: false, shuffle_options: false, question_count: 1 },
    questions: [
      {
        id: 'q_stub_01',
        module_id: 'mod_stub_01',
        objective_id: 'obj_stub_01',
        source_refs: ['blk_stub_03'],
        type: 'single_choice',
        difficulty: 'recall',
        stem: 'What is the primary control for slips, trips, and falls on this site?',
        options: [
          { id: 'opt_a', text: 'Keep walkways clear and report spills immediately' },
          { id: 'opt_b', text: 'Wear a hard hat at all times' },
          { id: 'opt_c', text: 'Avoid the site entirely' },
        ],
        correct_option_ids: ['opt_a'],
        rationale: 'Per blk_stub_03, clear walkways and prompt spill reporting are the stated administrative control.',
      },
    ],
    coverage_map: { obj_stub_01: ['q_stub_01'] },
  }
}

function buildEnvelope(
  jobId: string,
  stage: string,
  payload: Record<string, unknown>,
  options?: {
    stageImplVersion?: string
    inputRefs?: Record<string, unknown>
    kind?: 'code' | 'llm' | 'agent' | 'human'
    model?: string
  },
) {
  const kind = options?.kind ?? 'code'
  return {
    job_id: jobId,
    stage,
    attempt: 1,
    schema_version: '0.1',
    produced_at: new Date().toISOString(),
    produced_by: {
      kind,
      ...(options?.model ? { model: options.model } : {}),
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

// Loads the extracted_deck artifact from Supabase storage and returns its payload.
async function loadExtractedDeck(
  supabase: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<{ deck: Record<string, unknown>; ref: ArtifactRef }> {
  const { data: jobData, error: jobErr } = await supabase
    .from('generation_jobs')
    .select('artifacts')
    .eq('id', jobId)
    .single()
  if (jobErr) throw jobErr

  const artifacts = jobData.artifacts as JobRecord['artifacts']
  const ref = artifacts.extracted_deck
  if (!ref) throw new Error('extracted_deck artifact missing — cannot run structure stage')

  const { data: blob, error: dlErr } = await supabase.storage
    .from(ARTIFACTS_BUCKET)
    .download(ref.storage_key)
  if (dlErr) throw dlErr

  const envelope = JSON.parse(await blob.text()) as { payload: Record<string, unknown> }
  return { deck: envelope.payload, ref }
}

// Walks a job through queued → extracting → structuring → generating_quiz →
// qa_review → awaiting_approval (contracts §1).
// extracting: real deterministic parse (M0 Step 3)
// structuring: real Sonnet call (M2 Step 1)
// generating_quiz / qa_review: stubbed canned envelopes until M2 Steps 2–3
export const runGenerationJob = inngest.createFunction(
  { id: 'run-generation-job', triggers: [generationJobStart] },
  async ({ event, step }) => {
    const { jobId, siteId } = event.data
    const supabase = createAdminClient()

    // ── Extracting (real) ──────────────────────────────────────────────────
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

    // ── Structuring (real Sonnet — M2 Step 1) ─────────────────────────────
    await step.run('enter-structuring', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({ status: 'structuring', current_stage: 'structuring', updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    })

    await step.run('produce-structuring', async () => {
      const { deck, ref: extractedRef } = await loadExtractedDeck(supabase, jobId)
      const contentModel = await callStructure(deck, jobId, siteId)
      const envelope = buildEnvelope(jobId, 'structuring', contentModel as unknown as Record<string, unknown>, {
        stageImplVersion: STRUCTURE_STAGE_VERSION,
        inputRefs: { extracted_deck_sha256: extractedRef.sha256 },
        kind: 'llm',
        model: STRUCTURE_MODEL,
      })
      await storeArtifact(supabase, jobId, siteId, 'content_model', envelope)
    })

    // ── Generating quiz (stubbed — M2 Step 2) ─────────────────────────────
    await step.run('enter-generating_quiz', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({ status: 'generating_quiz', current_stage: 'generating_quiz', updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    })

    await step.sleep('pace-generating_quiz', '2s')

    await step.run('produce-generating_quiz', async () => {
      const envelope = buildEnvelope(jobId, 'generating_quiz', buildCannedQuiz())
      await storeArtifact(supabase, jobId, siteId, 'quiz', envelope)
    })

    // ── QA review (stubbed — always passes, M2 Step 3) ────────────────────
    await step.run('enter-qa_review', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({ status: 'qa_review', current_stage: 'qa_review', updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    })

    await step.sleep('pace-qa_review', '2s')

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

    // ── Awaiting approval ─────────────────────────────────────────────────
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
