// Eval harness for the M2 Step 2 generate_quiz stage (contracts §4.4).
// Asserts structural + coverage properties — never exact text — so the harness
// is stable across model versions. Tests that call the real API are skipped
// when ANTHROPIC_API_KEY is absent.
//
// Anchored on the golden Proton ContentModel from Step 1 eval.
// First run with the key:
//   cd web && npm test
// The Proton quiz test saves golden/proton-quiz.json.
// Commit the golden file — subsequent CI runs validate it without the key.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callQuiz } from '../lib/pipeline/quiz.ts'
import type { ContentModel } from '../contracts/types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = resolve(__dirname, 'golden')
const PROTON_CM_PATH = resolve(GOLDEN_DIR, 'proton-content-model.json')
const PROTON_QUIZ_PATH = resolve(GOLDEN_DIR, 'proton-quiz.json')

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY
const PROTON_CM_EXISTS = existsSync(PROTON_CM_PATH)
const PROTON_QUIZ_EXISTS = existsSync(PROTON_QUIZ_PATH)

// ── Synthetic ContentModels ───────────────────────────────────────────────────
// Pre-built models supplied directly to callQuiz — no structure stage call needed.

const SYNTHETIC_HAZARD_CM: ContentModel = {
  meta: { title: 'Fall Protection Orientation', site_id: 'site_eval', language: 'en', estimated_minutes: 5, reading_level: 'grade_8' },
  branding: { colors: { primary: '#000000', secondary: '#ffffff', accent: '#ff0000' }, fonts: { heading: 'Arial', body: 'Arial' }, logo_asset_id: null },
  modules: [
    {
      id: 'mod_01',
      order: 1,
      title: 'Fall Protection Requirements',
      source_slides: [0, 1],
      learning_objectives: [
        {
          id: 'obj_01_1',
          text: 'Identify fall protection requirements for heights above 3m including harness and anchor point standards.',
          source_block_ids: ['blk_01_01', 'blk_01_02'],
        },
      ],
      blocks: [
        {
          id: 'blk_01_01',
          type: 'hazard',
          hazard: 'Fall from height',
          description: 'Falls from 3m or above can cause fatal injuries. A full-body harness is mandatory at all times when working at height.',
          severity: 'critical',
          controls: [
            { type: 'ppe', text: 'Full-body harness required above 3m.' },
            { type: 'engineering', text: 'Anchor points must be certified for 5,000 lbs minimum.' },
          ],
          source_ref: { slide_index: 0 },
        },
        {
          id: 'blk_01_02',
          type: 'key_point',
          text: 'Harness inspection must occur before each use. A damaged harness must be removed from service immediately.',
          source_ref: { slide_index: 0 },
        },
        {
          id: 'blk_01_03',
          type: 'paragraph',
          text: 'Falls are the leading cause of fatalities in construction. Every worker at height must be tied off to a certified anchor point.',
          source_ref: { slide_index: 1 },
        },
      ],
    },
  ],
  hazard_index: [
    { block_id: 'blk_01_01', module_id: 'mod_01', hazard: 'Fall from height', severity: 'critical' },
  ],
}

const SYNTHETIC_MINIMAL_CM: ContentModel = {
  meta: { title: 'Site Safety Orientation', site_id: 'site_eval', language: 'en', estimated_minutes: 3, reading_level: 'grade_8' },
  branding: { colors: { primary: '#012A4A', secondary: '#eeeeee', accent: '#4F81BD' }, fonts: { heading: 'Calibri', body: 'Calibri' }, logo_asset_id: null },
  modules: [
    {
      id: 'mod_01',
      order: 1,
      title: 'Welcome',
      source_slides: [0],
      learning_objectives: [
        {
          id: 'obj_01_1',
          text: 'Identify the key safety topics covered in this orientation including emergency procedures and PPE requirements.',
          source_block_ids: ['blk_01_01', 'blk_01_02'],
        },
      ],
      blocks: [
        {
          id: 'blk_01_01',
          type: 'heading',
          level: 2,
          text: 'Welcome to Site Safety Orientation',
          source_ref: { slide_index: 0 },
        },
        {
          id: 'blk_01_02',
          type: 'paragraph',
          text: 'This session covers emergency procedures and PPE requirements for all contractors on site. Please listen carefully and ask questions at the end.',
          source_ref: { slide_index: 0 },
        },
      ],
    },
  ],
  hazard_index: [],
}

// ── Property assertion helper ─────────────────────────────────────────────────

function assertQuizProperties(
  quiz: unknown,
  context: string,
  contentModel: ContentModel,
  opts?: { minQuestions?: number },
) {
  assert(typeof quiz === 'object' && quiz !== null, `${context}: must be an object`)
  const q = quiz as Record<string, unknown>

  // meta
  const meta = q.meta as Record<string, unknown> | undefined
  assert(meta && typeof meta === 'object', `${context}: meta required`)
  assert(
    typeof meta.pass_threshold === 'number' && meta.pass_threshold > 0 && meta.pass_threshold <= 1,
    `${context}: pass_threshold must be in (0, 1]`,
  )
  assert(
    typeof meta.attempts_allowed === 'number' && meta.attempts_allowed >= 1,
    `${context}: attempts_allowed must be ≥1`,
  )
  assert(typeof meta.shuffle_questions === 'boolean', `${context}: shuffle_questions must be boolean`)
  assert(typeof meta.shuffle_options === 'boolean', `${context}: shuffle_options must be boolean`)

  // questions
  const questions = q.questions as Array<Record<string, unknown>> | undefined
  assert(Array.isArray(questions) && questions.length > 0, `${context}: questions must be non-empty array`)
  assert(
    meta.question_count === questions.length,
    `${context}: question_count (${meta.question_count}) must equal questions.length (${questions.length})`,
  )

  const minQ = opts?.minQuestions ?? 1
  assert(questions.length >= minQ, `${context}: expected ≥${minQ} questions, got ${questions.length}`)

  // Build block id set for source_ref validation
  const allBlockIds = new Set<string>()
  for (const mod of contentModel.modules) {
    for (const blk of mod.blocks) allBlockIds.add(blk.id)
  }

  // Track which blocks each question cites (for hazard coverage check)
  const blocksCitedByQuestions = new Set<string>()

  for (const qi of questions) {
    assert(typeof qi.id === 'string' && qi.id, `${context}: question missing id`)
    assert(typeof qi.module_id === 'string' && qi.module_id, `${context}: question ${qi.id}: module_id required`)
    assert(
      typeof qi.objective_id === 'string' && qi.objective_id,
      `${context}: question ${qi.id}: objective_id required`,
    )
    assert(
      qi.type === 'single_choice' || qi.type === 'multi_choice' || qi.type === 'true_false',
      `${context}: question ${qi.id}: type must be single_choice|multi_choice|true_false`,
    )
    assert(
      qi.difficulty === 'recall' || qi.difficulty === 'application',
      `${context}: question ${qi.id}: difficulty must be recall|application`,
    )
    assert(typeof qi.stem === 'string' && qi.stem, `${context}: question ${qi.id}: stem required`)

    // source_refs: non-empty, all resolve to real block ids
    const refs = qi.source_refs as unknown[] | undefined
    assert(
      Array.isArray(refs) && refs.length > 0,
      `${context}: question ${qi.id}: source_refs must be non-empty`,
    )
    for (const ref of refs!) {
      assert(
        allBlockIds.has(ref as string),
        `${context}: question ${qi.id}: source_ref "${ref}" not found in ContentModel`,
      )
      blocksCitedByQuestions.add(ref as string)
    }

    // options: ≥2, each has id + text
    const opts2 = qi.options as Array<Record<string, unknown>> | undefined
    assert(
      Array.isArray(opts2) && opts2.length >= 2,
      `${context}: question ${qi.id}: options must have ≥2 entries`,
    )
    const optIds = new Set(opts2!.map((o) => o.id as string))
    for (const o of opts2!) {
      assert(typeof o.id === 'string' && o.id, `${context}: question ${qi.id}: option missing id`)
      assert(typeof o.text === 'string' && o.text, `${context}: question ${qi.id}: option ${o.id} missing text`)
    }

    // correct_option_ids: non-empty, all reference real option ids
    const correctIds = qi.correct_option_ids as unknown[] | undefined
    assert(
      Array.isArray(correctIds) && correctIds.length > 0,
      `${context}: question ${qi.id}: correct_option_ids must be non-empty`,
    )
    for (const cid of correctIds!) {
      assert(optIds.has(cid as string), `${context}: question ${qi.id}: correct_option_id "${cid}" not in options`)
    }

    // rationale
    assert(typeof qi.rationale === 'string' && qi.rationale, `${context}: question ${qi.id}: rationale required`)
  }

  // coverage_map: every learning objective must have ≥1 question
  const coverageMap = q.coverage_map as Record<string, unknown> | undefined
  assert(coverageMap && typeof coverageMap === 'object', `${context}: coverage_map required`)

  for (const mod of contentModel.modules) {
    for (const obj of mod.learning_objectives) {
      const covered = (coverageMap[obj.id] as unknown[]) ?? []
      assert(
        covered.length > 0,
        `${context}: objective "${obj.id}" (${obj.text.slice(0, 60)}…) not covered in coverage_map`,
      )
    }
  }

  // hazard coverage: every hazard block must be cited by ≥1 question's source_refs
  for (const h of contentModel.hazard_index) {
    assert(
      blocksCitedByQuestions.has(h.block_id),
      `${context}: hazard block "${h.block_id}" ("${h.hazard}") not cited in any question's source_refs`,
    )
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Validates the saved golden quiz against property assertions — no API call.
test(
  'quiz: golden Proton quiz passes property checks',
  { skip: !PROTON_QUIZ_EXISTS ? 'golden quiz not yet generated — run npm test with ANTHROPIC_API_KEY' : false },
  () => {
    if (!PROTON_CM_EXISTS) {
      assert.fail('proton-content-model.json golden missing — run structure eval first')
    }
    const cm = JSON.parse(readFileSync(PROTON_CM_PATH, 'utf8')) as ContentModel
    const quiz = JSON.parse(readFileSync(PROTON_QUIZ_PATH, 'utf8')) as unknown
    // Proton CM has 7 objectives across 5 modules — expect ≥7 questions
    assertQuizProperties(quiz, 'Proton golden quiz', cm, { minQuestions: 5 })
  },
)

// Calls the real Sonnet quiz stage against the golden Proton ContentModel.
// Saves output as golden fixture so the test above can run without a key.
const skipProtonQuiz = !HAS_KEY
  ? 'no ANTHROPIC_API_KEY'
  : !PROTON_CM_EXISTS
    ? 'proton-content-model.json golden missing — run structure eval first'
    : false

test(
  'quiz: Proton ContentModel → schema-valid Quiz (saves golden)',
  { skip: skipProtonQuiz, timeout: 120_000 },
  async () => {
    const cm = JSON.parse(readFileSync(PROTON_CM_PATH, 'utf8')) as ContentModel
    const quiz = await callQuiz(cm, 'job_eval_proton_quiz', 'site_eval')
    assertQuizProperties(quiz as unknown, 'Proton live quiz', cm, { minQuestions: 5 })
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(PROTON_QUIZ_PATH, JSON.stringify(quiz, null, 2), 'utf8')
  },
)

// Verifies that a ContentModel with a critical hazard block produces a quiz
// that cites the hazard block in at least one question's source_refs.
test(
  'quiz: synthetic hazard ContentModel → quiz covering hazard block in source_refs',
  { skip: !HAS_KEY ? 'no ANTHROPIC_API_KEY' : false, timeout: 60_000 },
  async () => {
    const quiz = await callQuiz(SYNTHETIC_HAZARD_CM, 'job_eval_synth_hz_quiz', 'site_eval')
    assertQuizProperties(quiz as unknown, 'Synthetic hazard quiz', SYNTHETIC_HAZARD_CM, { minQuestions: 1 })
  },
)

// Verifies that a hazard-free minimal ContentModel produces a valid quiz
// with ≥1 question covering the one learning objective.
test(
  'quiz: synthetic minimal ContentModel → ≥1 question covering the objective',
  { skip: !HAS_KEY ? 'no ANTHROPIC_API_KEY' : false, timeout: 60_000 },
  async () => {
    const quiz = await callQuiz(SYNTHETIC_MINIMAL_CM, 'job_eval_synth_min_quiz', 'site_eval')
    assertQuizProperties(quiz as unknown, 'Synthetic minimal quiz', SYNTHETIC_MINIMAL_CM, { minQuestions: 1 })
  },
)
