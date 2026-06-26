import { createHash } from 'node:crypto'
import { inngest } from '../client'
import { generationJobStart } from '../events'
import { createAdminClient } from '@/lib/supabase/admin'
import { callStructure, STRUCTURE_MODEL, STRUCTURE_STAGE_VERSION } from '@/lib/pipeline/structure'
import { callQuiz, QUIZ_MODEL, QUIZ_STAGE_VERSION } from '@/lib/pipeline/quiz'
import { callQA, QA_MODEL, QA_STAGE_VERSION } from '@/lib/pipeline/qa'
import type { ArtifactRef, ContentModel, JobRecord, QAHistoryEntry, Quiz, SourceAsset } from '@/contracts/types'

const ARTIFACTS_BUCKET = 'pipeline-artifacts'
const SIGNED_URL_TTL_SECONDS = 300

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

async function loadContentModel(
  supabase: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<{ contentModel: ContentModel; ref: ArtifactRef }> {
  const { data: jobData, error: jobErr } = await supabase
    .from('generation_jobs')
    .select('artifacts')
    .eq('id', jobId)
    .single()
  if (jobErr) throw jobErr

  const artifacts = jobData.artifacts as JobRecord['artifacts']
  const ref = artifacts.content_model
  if (!ref) throw new Error('content_model artifact missing — cannot run generate_quiz stage')

  const { data: blob, error: dlErr } = await supabase.storage
    .from(ARTIFACTS_BUCKET)
    .download(ref.storage_key)
  if (dlErr) throw dlErr

  const envelope = JSON.parse(await blob.text()) as { payload: ContentModel }
  return { contentModel: envelope.payload, ref }
}

async function loadQuiz(
  supabase: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<{ quiz: Quiz; ref: ArtifactRef }> {
  const { data: jobData, error: jobErr } = await supabase
    .from('generation_jobs')
    .select('artifacts')
    .eq('id', jobId)
    .single()
  if (jobErr) throw jobErr

  const artifacts = jobData.artifacts as JobRecord['artifacts']
  const ref = artifacts.quiz
  if (!ref) throw new Error('quiz artifact missing — cannot run qa_review stage')

  const { data: blob, error: dlErr } = await supabase.storage
    .from(ARTIFACTS_BUCKET)
    .download(ref.storage_key)
  if (dlErr) throw dlErr

  const envelope = JSON.parse(await blob.text()) as { payload: Quiz }
  return { quiz: envelope.payload, ref }
}

// Walks a job through queued → extracting → structuring → generating_quiz →
// qa_review (bounded loop) → awaiting_approval (contracts §1).
// extracting: real deterministic parse (M0 Step 3)
// structuring: real Sonnet call (M2 Step 1)
// generating_quiz: real Sonnet call (M2 Step 2)
// qa_review: real Opus evaluator + bounded rework loop (M2 Step 3)
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

    // ── Generating quiz (real Sonnet — M2 Step 2) ─────────────────────────
    await step.run('enter-generating_quiz', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({ status: 'generating_quiz', current_stage: 'generating_quiz', updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    })

    await step.run('produce-generating_quiz', async () => {
      const { contentModel, ref: contentModelRef } = await loadContentModel(supabase, jobId)
      const quiz = await callQuiz(contentModel, jobId, siteId)
      const envelope = buildEnvelope(jobId, 'generating_quiz', quiz as unknown as Record<string, unknown>, {
        stageImplVersion: QUIZ_STAGE_VERSION,
        inputRefs: { content_model_sha256: contentModelRef.sha256 },
        kind: 'llm',
        model: QUIZ_MODEL,
      })
      await storeArtifact(supabase, jobId, siteId, 'quiz', envelope)
    })

    // ── QA review loop (real Opus — M2 Step 3b) ──────────────────────────
    // Bounded loop per contracts §1. At most max_rework+1 QA cycles.
    // The orchestrator owns every routing decision; the model only judges.
    // Unique step IDs per cycle (produce-qa_review-0, produce-qa_review-1, …)
    // let Inngest memoize each cycle independently across replays.
    const { data: jd, error: jdErr } = await supabase
      .from('generation_jobs')
      .select('max_rework')
      .eq('id', jobId)
      .single()
    if (jdErr) throw jdErr
    const maxRework = (jd.max_rework as number) ?? 3

    let qaFlagged = false

    for (let qaCycle = 0; qaCycle <= maxRework; qaCycle++) {
      await step.run(`enter-qa_review-${qaCycle}`, async () => {
        const { error } = await supabase
          .from('generation_jobs')
          .update({ status: 'qa_review', current_stage: 'qa_review', updated_at: new Date().toISOString() })
          .eq('id', jobId)
        if (error) throw error
      })

      const qaResult = await step.run(`produce-qa_review-${qaCycle}`, async () => {
        const { deck, ref: deckRef } = await loadExtractedDeck(supabase, jobId)
        const { contentModel, ref: contentModelRef } = await loadContentModel(supabase, jobId)
        const { quiz, ref: quizRef } = await loadQuiz(supabase, jobId)

        const { data: jobData, error: jobErr } = await supabase
          .from('generation_jobs')
          .select('rework_count, max_rework')
          .eq('id', jobId)
          .single()
        if (jobErr) throw jobErr
        const reworkCount = (jobData.rework_count as number) ?? 0
        const maxReworkInner = (jobData.max_rework as number) ?? 3

        const verdict = await callQA(deck, contentModel, quiz, jobId, siteId, reworkCount, maxReworkInner)

        const envelope = buildEnvelope(jobId, 'qa_review', verdict as unknown as Record<string, unknown>, {
          stageImplVersion: QA_STAGE_VERSION,
          inputRefs: {
            extracted_deck_sha256: deckRef.sha256,
            content_model_sha256: contentModelRef.sha256,
            quiz_sha256: quizRef.sha256,
          },
          kind: 'agent',
          model: QA_MODEL,
        })
        await storeArtifact(supabase, jobId, siteId, 'qa_verdict', envelope)

        const openIssueCount = verdict.issues.filter(
          (i) => i.severity === 'blocker' || i.severity === 'major',
        ).length

        const verdictEntry: QAHistoryEntry = {
          attempt: reworkCount + 1,
          verdict: verdict.verdict,
          routed_to: verdict.routed_to,
          open_issue_count: openIssueCount,
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

        return {
          verdict: verdict.verdict,
          routed_to: verdict.routed_to,
          decision: verdict.decision,
        }
      })

      // Orchestrator owns the routing decision (contracts §1, §4.5)
      if (qaResult.verdict === 'pass') break

      if (qaResult.decision === 'escalate') {
        // Budget exhausted — advance to approval with qa_flagged=true (never fail)
        qaFlagged = true
        break
      }

      // decision === 'rework' — increment counter in DB then re-run the routed stage(s)
      await step.run(`increment-rework-${qaCycle}`, async () => {
        const { data: cur, error: curErr } = await supabase
          .from('generation_jobs')
          .select('rework_count')
          .eq('id', jobId)
          .single()
        if (curErr) throw curErr
        const newCount = ((cur.rework_count as number) ?? 0) + 1
        const { error: updErr } = await supabase
          .from('generation_jobs')
          .update({ rework_count: newCount, updated_at: new Date().toISOString() })
          .eq('id', jobId)
        if (updErr) throw updErr
      })

      // When issues span both stages, route to structure first (upstream fixes
      // may resolve downstream quiz issues — contracts §4.5)
      if (qaResult.routed_to === 'structure') {
        await step.run(`enter-structuring-rework-${qaCycle}`, async () => {
          const { error } = await supabase
            .from('generation_jobs')
            .update({ status: 'structuring', current_stage: 'structuring', updated_at: new Date().toISOString() })
            .eq('id', jobId)
          if (error) throw error
        })

        await step.run(`produce-structuring-rework-${qaCycle}`, async () => {
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
      }

      // Quiz always re-runs on any rework path (it is downstream of structure)
      await step.run(`enter-generating_quiz-rework-${qaCycle}`, async () => {
        const { error } = await supabase
          .from('generation_jobs')
          .update({ status: 'generating_quiz', current_stage: 'generating_quiz', updated_at: new Date().toISOString() })
          .eq('id', jobId)
        if (error) throw error
      })

      await step.run(`produce-generating_quiz-rework-${qaCycle}`, async () => {
        const { contentModel, ref: contentModelRef } = await loadContentModel(supabase, jobId)
        const quiz = await callQuiz(contentModel, jobId, siteId)
        const envelope = buildEnvelope(jobId, 'generating_quiz', quiz as unknown as Record<string, unknown>, {
          stageImplVersion: QUIZ_STAGE_VERSION,
          inputRefs: { content_model_sha256: contentModelRef.sha256 },
          kind: 'llm',
          model: QUIZ_MODEL,
        })
        await storeArtifact(supabase, jobId, siteId, 'quiz', envelope)
      })
    }

    // ── Awaiting approval ─────────────────────────────────────────────────
    await step.run('enter-awaiting_approval', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({
          status: 'awaiting_approval',
          current_stage: 'awaiting_approval',
          qa_flagged: qaFlagged,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
      if (error) throw error
    })

    return { jobId, status: 'awaiting_approval' as const }
  },
)
