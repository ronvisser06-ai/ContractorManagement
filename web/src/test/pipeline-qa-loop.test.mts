// Eval harness for the M2 Step 3b QA rework loop (contracts §1).
//
// Three concerns tested here:
//   (a) Routing decision logic — unit tests, no API calls.
//   (b) Termination proof — worst-case loop simulation, no API calls.
//   (c) Live escalation and rework decisions from real Opus calls.
//
// All live tests use the synthetic wrong-answer deck from pipeline-qa.test.mts
// (duplicated here to avoid cross-test-file imports). The synthetic deck is
// cheap — 1 slide, 1 question — and reliably produces needs_rework.
//
// Proton deck is NOT re-run here (cost control). The existing pipeline-qa.test
// already validates structural correctness on the Proton golden artifacts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callQA, deriveReworkDecision } from '../lib/pipeline/qa.ts'
import type { ContentModel, Quiz } from '../contracts/types.ts'

// ── Synthetic wrong-answer fixtures (copied from pipeline-qa.test.mts) ────────
// Source says "ONLY in designated eye hazard zones"; correct_option_ids marks
// "At all times throughout the entire facility" — a direct contradiction the
// evaluator must flag as a correctness blocker.

const SYNTHETIC_WRONG_DECK: Record<string, unknown> = {
  source: { type: 'pptx', slide_count: 1, sha256: 'synth-wrong-sha256' },
  branding: {
    colors: { primary: '#000000', secondary: '#ffffff', accent: '#ff0000' },
    fonts: { heading: 'Arial', body: 'Arial' },
    logo_asset_id: null,
  },
  assets: [],
  slides: [
    {
      index: 0,
      id: 'slide_0',
      title: 'Eye Protection Policy',
      text_runs: [
        { shape_index: 0, level: 0, bold: true, text: 'Eye Protection Policy' },
        {
          shape_index: 1,
          level: 0,
          bold: false,
          text: 'Safety glasses are ONLY required in designated eye hazard zones, not throughout the facility.',
        },
        {
          shape_index: 1,
          level: 1,
          bold: false,
          text: 'Designated zones are marked with yellow floor tape and posted warning signs.',
        },
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
  meta: {
    title: 'Eye Protection Orientation',
    site_id: 'site_eval',
    language: 'en',
    estimated_minutes: 2,
    reading_level: 'grade_8',
  },
  branding: {
    colors: { primary: '#000000', secondary: '#ffffff', accent: '#ff0000' },
    fonts: { heading: 'Arial', body: 'Arial' },
    logo_asset_id: null,
  },
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

const SYNTHETIC_WRONG_QUIZ: Quiz = {
  meta: {
    pass_threshold: 0.8,
    attempts_allowed: 3,
    shuffle_questions: true,
    shuffle_options: true,
    question_count: 1,
  },
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
        { id: 'opt_b', text: 'At all times throughout the entire facility' }, // marked correct — wrong!
        { id: 'opt_c', text: 'Only when handling chemicals or solvents' },
      ],
      correct_option_ids: ['opt_b'], // contradicts blk_01_01
      rationale: 'All workers must wear safety glasses at all times for full protection.',
    },
  ],
  coverage_map: { 'obj_01_1': ['q_01'] },
}

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY

// ── (a) Routing decision unit tests (no API calls) ────────────────────────────

test('rework routing: pass → proceed regardless of rework_count', () => {
  assert.equal(deriveReworkDecision('pass', 0, 3), 'proceed')
  assert.equal(deriveReworkDecision('pass', 3, 3), 'proceed') // even if at limit
  assert.equal(deriveReworkDecision('pass', 99, 3), 'proceed')
})

test('rework routing: needs_rework, within budget → rework', () => {
  assert.equal(deriveReworkDecision('needs_rework', 0, 3), 'rework') // first cycle
  assert.equal(deriveReworkDecision('needs_rework', 1, 3), 'rework')
  assert.equal(deriveReworkDecision('needs_rework', 2, 3), 'rework') // last rework slot
  assert.equal(deriveReworkDecision('needs_rework', 0, 1), 'rework') // max_rework=1
})

test('rework routing: needs_rework, budget exhausted → escalate', () => {
  assert.equal(deriveReworkDecision('needs_rework', 3, 3), 'escalate') // rework_count == max
  assert.equal(deriveReworkDecision('needs_rework', 4, 3), 'escalate') // rework_count > max
  assert.equal(deriveReworkDecision('needs_rework', 1, 1), 'escalate') // max_rework=1 exhausted
  assert.equal(deriveReworkDecision('needs_rework', 0, 0), 'escalate') // max_rework=0
})

// ── (b) Termination proof (no API calls) ──────────────────────────────────────
// Simulates a worst-case loop where every QA verdict is needs_rework.
// Proves the loop terminates in exactly max_rework iterations.

test('rework loop termination: worst-case (all needs_rework) exhausts in max_rework iterations', () => {
  for (const maxRework of [0, 1, 2, 3, 5]) {
    let reworkCount = 0
    let iterations = 0
    const LOOP_GUARD = 1000

    while (iterations < LOOP_GUARD) {
      const decision = deriveReworkDecision('needs_rework', reworkCount, maxRework)
      if (decision === 'escalate') break
      // decision === 'rework' — simulate increment
      reworkCount++
      iterations++
    }

    assert(iterations < LOOP_GUARD, `max_rework=${maxRework}: loop did not terminate — BUG`)
    assert.equal(
      reworkCount,
      maxRework,
      `max_rework=${maxRework}: expected rework_count to reach ${maxRework}, got ${reworkCount}`,
    )
    assert.equal(
      iterations,
      maxRework,
      `max_rework=${maxRework}: expected exactly ${maxRework} rework steps, got ${iterations}`,
    )
  }
})

// ── (c) Live API tests (2 Opus calls, skip without key) ───────────────────────

// Proves that at budget exhaustion (rework_count === max_rework), callQA returns
// decision=escalate. Uses max_rework=2 to keep call count minimal.
test(
  'qa loop: at budget exhaustion (rework_count=max_rework) → decision=escalate',
  { skip: !HAS_KEY ? 'no ANTHROPIC_API_KEY' : false, timeout: 60_000 },
  async () => {
    const maxRework = 2
    const verdict = await callQA(
      SYNTHETIC_WRONG_DECK,
      SYNTHETIC_WRONG_CM,
      SYNTHETIC_WRONG_QUIZ,
      'job_loop_escalate_test',
      'site_eval',
      maxRework, // rework_count = max_rework → should escalate
      maxRework,
    )
    assert.equal(
      verdict.verdict,
      'needs_rework',
      `expected needs_rework (synthetic wrong deck must fail QA)`,
    )
    assert.equal(
      verdict.decision,
      'escalate',
      `expected escalate when rework_count (${maxRework}) >= max_rework (${maxRework}), got "${verdict.decision}"`,
    )
    assert.equal(verdict.rework_count, maxRework)
    assert.equal(verdict.max_rework, maxRework)
  },
)

// Proves that within the rework budget, callQA returns decision=rework so the
// orchestrator re-enters the pipeline.
test(
  'qa loop: within budget (rework_count=1, max_rework=3) → decision=rework',
  { skip: !HAS_KEY ? 'no ANTHROPIC_API_KEY' : false, timeout: 60_000 },
  async () => {
    const verdict = await callQA(
      SYNTHETIC_WRONG_DECK,
      SYNTHETIC_WRONG_CM,
      SYNTHETIC_WRONG_QUIZ,
      'job_loop_rework_test',
      'site_eval',
      1, // rework_count=1, well within budget
      3, // max_rework=3
    )
    assert.equal(verdict.verdict, 'needs_rework')
    assert.equal(
      verdict.decision,
      'rework',
      `expected rework when rework_count (1) < max_rework (3), got "${verdict.decision}"`,
    )
    assert.equal(verdict.rework_count, 1)
    assert.equal(verdict.max_rework, 3)
  },
)
