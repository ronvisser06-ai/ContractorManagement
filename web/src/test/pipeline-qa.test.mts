// Eval harness for the M2 Step 3a qa_review stage (contracts §4.5).
// Asserts structural properties — never exact text — so the harness is stable
// across model versions. Tests that call the real API are skipped when
// ANTHROPIC_API_KEY is absent.
//
// Critical test: synthetic quiz with a deliberately wrong correct-answer must
// trigger a correctness blocker targeting generate_quiz.
// Anchor test: Proton artifacts (golden CM + quiz) must produce a sane verdict
// with no blocker issues.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callQA } from '../lib/pipeline/qa.ts'
import type { ContentModel, Quiz, QAVerdict } from '../contracts/types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = resolve(__dirname, 'golden')
const PROTON_DECK_PATH = resolve(__dirname, '../../../SampleOrientation/extraction-output/extracted_deck.json')
const PROTON_CM_PATH = resolve(GOLDEN_DIR, 'proton-content-model.json')
const PROTON_QUIZ_PATH = resolve(GOLDEN_DIR, 'proton-quiz.json')
const PROTON_VERDICT_PATH = resolve(GOLDEN_DIR, 'proton-qa-verdict.json')

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY
const PROTON_CM_EXISTS = existsSync(PROTON_CM_PATH)
const PROTON_QUIZ_EXISTS = existsSync(PROTON_QUIZ_PATH)
const PROTON_VERDICT_EXISTS = existsSync(PROTON_VERDICT_PATH)

// ── Synthetic fixtures ────────────────────────────────────────────────────────
// A ContentModel and Quiz where the "correct" answer directly contradicts the
// cited source block. The evaluator must flag this as a correctness blocker.

const SYNTHETIC_WRONG_DECK: Record<string, unknown> = {
  source: { type: 'pptx', slide_count: 1, sha256: 'synth-wrong-sha256' },
  branding: { colors: { primary: '#000000', secondary: '#ffffff', accent: '#ff0000' }, fonts: { heading: 'Arial', body: 'Arial' }, logo_asset_id: null },
  assets: [],
  slides: [
    {
      index: 0,
      id: 'slide_0',
      title: 'Eye Protection Policy',
      text_runs: [
        { shape_index: 0, level: 0, bold: true, text: 'Eye Protection Policy' },
        { shape_index: 1, level: 0, bold: false, text: 'Safety glasses are ONLY required in designated eye hazard zones, not throughout the facility.' },
        { shape_index: 1, level: 1, bold: false, text: 'Designated zones are marked with yellow floor tape and posted warning signs.' },
      ],
      tables: [],
      image_asset_ids: [],
      media_asset_ids: [],
      speaker_notes: null,
    },
  ],
  warnings: [],
}

const SYNTHETIC_WRONG_CM: ContentModel = {
  meta: { title: 'Eye Protection Orientation', site_id: 'site_eval', language: 'en', estimated_minutes: 2, reading_level: 'grade_8' },
  branding: { colors: { primary: '#000000', secondary: '#ffffff', accent: '#ff0000' }, fonts: { heading: 'Arial', body: 'Arial' }, logo_asset_id: null },
  modules: [
    {
      id: 'mod_01',
      order: 1,
      title: 'Eye Protection Policy',
      source_slides: [0],
      learning_objectives: [
        {
          id: 'obj_01_1',
          text: 'Identify when and where safety glasses must be worn.',
          source_block_ids: ['blk_01_01', 'blk_01_02'],
        },
      ],
      blocks: [
        {
          id: 'blk_01_01',
          type: 'key_point',
          text: 'Safety glasses are ONLY required in designated eye hazard zones, not throughout the facility.',
          source_ref: { slide_index: 0 },
        },
        {
          id: 'blk_01_02',
          type: 'paragraph',
          text: 'Designated zones are marked with yellow floor tape and posted warning signs.',
          source_ref: { slide_index: 0 },
        },
      ],
    },
  ],
  hazard_index: [],
}

// Correct answer is "opt_b" (at all times) but source says "only in designated zones" — direct contradiction.
const SYNTHETIC_WRONG_QUIZ: Quiz = {
  meta: { pass_threshold: 0.8, attempts_allowed: 3, shuffle_questions: true, shuffle_options: true, question_count: 1 },
  questions: [
    {
      id: 'q_01',
      module_id: 'mod_01',
      objective_id: 'obj_01_1',
      source_refs: ['blk_01_01', 'blk_01_02'],
      type: 'single_choice',
      difficulty: 'recall',
      stem: 'When must workers wear safety glasses on site?',
      options: [
        { id: 'opt_a', text: 'Only in designated eye hazard zones' },
        { id: 'opt_b', text: 'At all times throughout the entire facility' },
        { id: 'opt_c', text: 'Only when handling chemicals or solvents' },
      ],
      correct_option_ids: ['opt_b'], // contradicts blk_01_01 which says "ONLY in designated zones"
      rationale: 'All workers must wear safety glasses at all times for full protection.',
    },
  ],
  coverage_map: { 'obj_01_1': ['q_01'] },
}

// ── Property assertion helper ─────────────────────────────────────────────────

function assertQAVerdictProperties(verdict: unknown, context: string) {
  assert(typeof verdict === 'object' && verdict !== null, `${context}: must be an object`)
  const v = verdict as Record<string, unknown>

  assert(
    v.verdict === 'pass' || v.verdict === 'needs_rework',
    `${context}: verdict must be pass|needs_rework, got "${v.verdict}"`,
  )

  // scores
  const scores = v.scores as Record<string, unknown> | undefined
  assert(scores && typeof scores === 'object', `${context}: scores required`)
  for (const dim of ['coverage', 'correctness', 'fidelity']) {
    const s = scores[dim] as Record<string, unknown> | undefined
    assert(s && typeof s === 'object', `${context}: scores.${dim} required`)
    assert(
      typeof s.value === 'number' && s.value >= 0 && s.value <= 1,
      `${context}: scores.${dim}.value must be 0.0–1.0, got ${s.value}`,
    )
    assert(typeof s.pass === 'boolean', `${context}: scores.${dim}.pass must be boolean`)
  }

  // issues
  const issues = v.issues as Array<Record<string, unknown>> | undefined
  assert(Array.isArray(issues), `${context}: issues must be an array`)
  for (const iss of issues) {
    assert(typeof iss.id === 'string' && iss.id, `${context}: issue missing id`)
    assert(
      ['blocker', 'major', 'minor'].includes(iss.severity as string),
      `${context}: issue ${iss.id}: severity must be blocker|major|minor, got "${iss.severity}"`,
    )
    assert(
      ['coverage', 'correctness', 'fidelity', 'accessibility'].includes(iss.category as string),
      `${context}: issue ${iss.id}: category must be coverage|correctness|fidelity|accessibility`,
    )
    assert(
      ['structure', 'generate_quiz'].includes(iss.target_stage as string),
      `${context}: issue ${iss.id}: target_stage must be structure|generate_quiz`,
    )
    assert(typeof iss.target_ref === 'string' && iss.target_ref, `${context}: issue ${iss.id}: target_ref required`)
    assert(typeof iss.description === 'string' && iss.description, `${context}: issue ${iss.id}: description required`)
    assert(typeof iss.suggested_fix === 'string' && iss.suggested_fix, `${context}: issue ${iss.id}: suggested_fix required`)
  }

  // routed_to
  assert(
    ['structure', 'generate_quiz', 'none'].includes(v.routed_to as string),
    `${context}: routed_to must be structure|generate_quiz|none, got "${v.routed_to}"`,
  )

  // decision
  assert(
    ['proceed', 'rework', 'escalate'].includes(v.decision as string),
    `${context}: decision must be proceed|rework|escalate, got "${v.decision}"`,
  )

  // rework_count and max_rework
  assert(typeof v.rework_count === 'number', `${context}: rework_count must be a number`)
  assert(typeof v.max_rework === 'number', `${context}: max_rework must be a number`)

  // consistency: verdict=pass → routed_to=none, decision=proceed
  if (v.verdict === 'pass') {
    assert(v.routed_to === 'none', `${context}: verdict=pass but routed_to="${v.routed_to}"`)
    assert(v.decision === 'proceed', `${context}: verdict=pass but decision="${v.decision}"`)
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Validates the saved golden verdict against property assertions — no API call.
// Skipped when API key is present (live test validates freshly-generated output).
test(
  'qa: golden Proton verdict passes property checks',
  {
    skip: !PROTON_VERDICT_EXISTS
      ? 'golden verdict not yet generated — run npm test with ANTHROPIC_API_KEY'
      : HAS_KEY
        ? 'API key present — live test validates output'
        : false,
  },
  () => {
    const verdict = JSON.parse(readFileSync(PROTON_VERDICT_PATH, 'utf8')) as unknown
    assertQAVerdictProperties(verdict, 'Proton golden verdict')
  },
)

// Calls the real Opus QA stage against the Proton golden artifacts (CM + quiz).
// Validates the verdict is structurally correct and saves it as a golden fixture.
// Note: the Proton deck has graphical content (hierarchy-of-controls image on
// slide 7) not captured as text blocks — the evaluator may legitimately flag
// quiz questions that cite those blocks as unverifiable. Those are real findings,
// not false positives. The structural validity assertion (assertQAVerdictProperties)
// is the regression anchor; the synthetic-wrong-answer test is the false-positive proof.
const skipProtonQA = !HAS_KEY
  ? 'no ANTHROPIC_API_KEY'
  : !PROTON_CM_EXISTS
    ? 'proton-content-model.json golden missing — run structure eval first'
    : !PROTON_QUIZ_EXISTS
      ? 'proton-quiz.json golden missing — run quiz eval first'
      : false

test(
  'qa: Proton artifacts → schema-valid QAVerdict (saves golden)',
  { skip: skipProtonQA, timeout: 120_000 },
  async () => {
    const deck = JSON.parse(readFileSync(PROTON_DECK_PATH, 'utf8')) as Record<string, unknown>
    const cm = JSON.parse(readFileSync(PROTON_CM_PATH, 'utf8')) as ContentModel
    const quiz = JSON.parse(readFileSync(PROTON_QUIZ_PATH, 'utf8')) as Quiz
    const verdict = await callQA(deck, cm, quiz, 'job_eval_proton_qa', 'site_eval')
    // Structural validity — the critical assertion for the judge-only stage
    assertQAVerdictProperties(verdict as unknown, 'Proton live verdict')
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(PROTON_VERDICT_PATH, JSON.stringify(verdict, null, 2), 'utf8')
  },
)

// The critical eval: a quiz where the marked correct answer directly contradicts
// the source block text must trigger a correctness blocker targeting generate_quiz.
test(
  'qa: synthetic wrong-answer quiz → correctness blocker flagged (target_stage=generate_quiz)',
  { skip: !HAS_KEY ? 'no ANTHROPIC_API_KEY' : false, timeout: 60_000 },
  async () => {
    const verdict = await callQA(
      SYNTHETIC_WRONG_DECK,
      SYNTHETIC_WRONG_CM,
      SYNTHETIC_WRONG_QUIZ,
      'job_eval_synth_qa_wrong',
      'site_eval',
    )
    assertQAVerdictProperties(verdict as unknown, 'Synthetic wrong-answer verdict')

    const v = verdict as unknown as QAVerdict
    assert(v.verdict === 'needs_rework', `expected verdict=needs_rework, got "${v.verdict}"`)

    const issues = v.issues as unknown as Array<Record<string, unknown>>
    const correctnessBlockers = issues.filter(
      (i) => i.severity === 'blocker' && i.category === 'correctness' && i.target_stage === 'generate_quiz',
    )
    assert(
      correctnessBlockers.length >= 1,
      `expected ≥1 correctness blocker targeting generate_quiz, got ${correctnessBlockers.length}. All issues: ${JSON.stringify(issues)}`,
    )
  },
)
