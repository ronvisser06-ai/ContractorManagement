// Eval harness for the M2 Step 1 structure stage (contracts §4.2).
// Asserts structural + coverage properties — never exact text — so the harness
// is stable across model versions. Tests that call the real API are skipped
// when ANTHROPIC_API_KEY is absent; all other tests run without the key.
//
// First run with the key:
//   cd web && npm test
// The Proton test generates and saves golden/proton-content-model.json.
// Commit the golden file — subsequent CI runs validate it without the key.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateBlocks } from '../lib/renderer/validate.ts'
import { callStructure } from '../lib/pipeline/structure.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PROTON_DECK_PATH = resolve(__dirname, '../../../SampleOrientation/extraction-output/extracted_deck.json')
const GOLDEN_DIR = resolve(__dirname, 'golden')
const PROTON_GOLDEN_PATH = resolve(GOLDEN_DIR, 'proton-content-model.json')

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY
const PROTON_GOLDEN_EXISTS = existsSync(PROTON_GOLDEN_PATH)

// ── Synthetic fixtures ────────────────────────────────────────────────────────

const SYNTHETIC_HAZARD_DECK = {
  source: { type: 'pptx', slide_count: 2, sha256: 'synth-hazard-sha256' },
  branding: { colors: { primary: '#000', secondary: '#fff', accent: '#f00' }, fonts: { heading: 'Arial', body: 'Arial' }, logo_asset_id: null },
  assets: [],
  slides: [
    {
      index: 0,
      id: 'slide_0',
      title: 'Fall Protection Requirements',
      text_runs: [
        { shape_index: 0, level: 0, bold: true, text: 'Fall Protection Requirements' },
        { shape_index: 1, level: 0, bold: false, text: 'All workers at height above 3 m must wear a full-body harness.' },
        { shape_index: 1, level: 1, bold: false, text: 'Anchor points must be certified for 5,000 lbs minimum.' },
        { shape_index: 2, level: 0, bold: false, text: 'Falls are the leading cause of fatalities in construction.' },
      ],
      tables: [],
      image_asset_ids: [],
      media_asset_ids: [],
      speaker_notes: 'Emphasize that harness inspection must occur before each use.',
    },
    {
      index: 1,
      id: 'slide_1',
      title: 'Orientation Complete',
      text_runs: [
        { shape_index: 0, level: 0, bold: true, text: 'Orientation Complete' },
        { shape_index: 1, level: 0, bold: false, text: 'You have completed the fall protection section.' },
      ],
      tables: [],
      image_asset_ids: [],
      media_asset_ids: [],
      speaker_notes: null,
    },
  ],
  warnings: [],
}

const SYNTHETIC_MINIMAL_DECK = {
  source: { type: 'pptx', slide_count: 1, sha256: 'synth-minimal-sha256' },
  branding: { colors: { primary: '#012A4A', secondary: '#eee', accent: '#4F81BD' }, fonts: { heading: 'Calibri', body: 'Calibri' }, logo_asset_id: null },
  assets: [],
  slides: [
    {
      index: 0,
      id: 'slide_0',
      title: 'Welcome',
      text_runs: [
        { shape_index: 0, level: 0, bold: true, text: 'Welcome to Site Safety Orientation' },
        { shape_index: 1, level: 0, bold: false, text: 'This session covers emergency procedures and PPE requirements for all contractors on site.' },
        { shape_index: 2, level: 0, bold: false, text: 'Please listen carefully and ask questions at the end.' },
      ],
      tables: [],
      image_asset_ids: [],
      media_asset_ids: [],
      speaker_notes: 'Keep it brief — this is just the welcome slide.',
    },
  ],
  warnings: [],
}

// ── Property assertion helper ─────────────────────────────────────────────────

function assertContentModelProperties(
  cm: unknown,
  context: string,
  opts?: { minModules?: number; minHazards?: number; minBlocks?: number },
) {
  assert(typeof cm === 'object' && cm !== null, `${context}: must be an object`)
  const model = cm as Record<string, unknown>

  // meta
  const meta = model.meta as Record<string, unknown> | undefined
  assert(meta && typeof meta === 'object', `${context}: meta must be an object`)
  assert(typeof meta.title === 'string' && meta.title.length > 0, `${context}: meta.title required`)
  assert(typeof meta.site_id === 'string' && meta.site_id.length > 0, `${context}: meta.site_id required`)
  assert(typeof meta.estimated_minutes === 'number' && meta.estimated_minutes > 0, `${context}: meta.estimated_minutes must be > 0`)
  assert(typeof meta.language === 'string', `${context}: meta.language required`)

  // modules
  const modules = model.modules as Array<Record<string, unknown>> | undefined
  assert(Array.isArray(modules), `${context}: modules must be array`)
  const minModules = opts?.minModules ?? 1
  assert(modules.length >= minModules, `${context}: expected ≥${minModules} modules, got ${modules.length}`)

  let totalBlocks = 0
  for (const mod of modules) {
    assert(typeof mod.id === 'string' && mod.id.length > 0, `${context}: module must have id`)
    assert(typeof mod.title === 'string' && mod.title.length > 0, `${context}: module ${mod.id} must have title`)
    assert(Array.isArray(mod.source_slides), `${context}: module ${mod.id} must have source_slides[]`)

    const objs = mod.learning_objectives as unknown[]
    assert(Array.isArray(objs) && objs.length > 0, `${context}: module ${mod.id} must have ≥1 learning_objective`)

    const blocks = mod.blocks as unknown[]
    assert(Array.isArray(blocks) && blocks.length > 0, `${context}: module ${mod.id} must have ≥1 block`)
    totalBlocks += blocks.length

    const { errors } = validateBlocks(blocks)
    assert.equal(
      errors.length,
      0,
      `${context}: module ${mod.id} has block validation errors: ${errors.map((e) => e.reason).join(', ')}`,
    )

    // Every block must have source_ref.slide_index
    for (const blk of blocks as Array<Record<string, unknown>>) {
      const ref = blk.source_ref as Record<string, unknown> | undefined
      assert(
        typeof ref === 'object' && ref !== null && typeof ref.slide_index === 'number',
        `${context}: block ${blk.id ?? '?'} in module ${mod.id} missing valid source_ref.slide_index`,
      )
    }
  }

  const minBlocks = opts?.minBlocks ?? 2
  assert(totalBlocks >= minBlocks, `${context}: expected ≥${minBlocks} total blocks, got ${totalBlocks}`)

  // hazard_index
  const hazardIndex = model.hazard_index as Array<Record<string, unknown>> | undefined
  assert(Array.isArray(hazardIndex), `${context}: hazard_index must be array`)

  const minHazards = opts?.minHazards ?? 0
  assert(hazardIndex.length >= minHazards, `${context}: expected ≥${minHazards} hazard entries, got ${hazardIndex.length}`)

  // hazard_index entries must reference valid block ids
  const allBlockIds = new Set<string>()
  for (const mod of modules) {
    for (const blk of (mod.blocks as Array<Record<string, unknown>>) ?? []) {
      if (typeof blk.id === 'string') allBlockIds.add(blk.id)
    }
  }
  for (const entry of hazardIndex) {
    assert(
      allBlockIds.has(entry.block_id as string),
      `${context}: hazard_index block_id "${entry.block_id}" not found in any module`,
    )
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Validates the saved golden fixture against property assertions — no API call.
// Skips if the golden file hasn't been generated yet (first run with key will create it).
// Anchor deck: 10-slide Proton H2 OH&S orientation (V3.0 draft).
test(
  'structure: golden Proton content model passes property checks',
  { skip: !PROTON_GOLDEN_EXISTS ? 'golden not yet generated — run npm test with ANTHROPIC_API_KEY' : false },
  () => {
    const raw = JSON.parse(readFileSync(PROTON_GOLDEN_PATH, 'utf8')) as unknown
    // 10 slides → expect ≥2 modules; hazards optional (policy/intro deck, not site-specific)
    assertContentModelProperties(raw, 'Proton golden', { minModules: 2, minHazards: 0, minBlocks: 8 })
  },
)

// Calls the real Sonnet structure stage against the Proton deck (10 slides).
// Saves output as golden fixture so the test above can run without a key afterward.
test(
  'structure: Proton deck → schema-valid ContentModel (saves golden)',
  { skip: !HAS_KEY ? 'no ANTHROPIC_API_KEY' : false, timeout: 120_000 },
  async () => {
    const deck = JSON.parse(readFileSync(PROTON_DECK_PATH, 'utf8')) as Record<string, unknown>
    const cm = await callStructure(deck, 'job_eval_proton', 'site_eval')
    assertContentModelProperties(cm as unknown, 'Proton live', { minModules: 2, minHazards: 0, minBlocks: 8 })
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(PROTON_GOLDEN_PATH, JSON.stringify(cm, null, 2), 'utf8')
  },
)

// Verifies a deck with explicit fall-protection content produces a hazard block
// and a non-empty hazard_index.
test(
  'structure: synthetic 2-slide hazard deck → non-empty hazard_index',
  { skip: !HAS_KEY ? 'no ANTHROPIC_API_KEY' : false, timeout: 60_000 },
  async () => {
    const cm = await callStructure(SYNTHETIC_HAZARD_DECK as Record<string, unknown>, 'job_eval_synth1', 'site_eval')
    assertContentModelProperties(cm as unknown, 'Synthetic hazard', { minModules: 1, minHazards: 1 })
  },
)

// Verifies a minimal 1-slide deck produces at least one module with valid blocks
// (no hazard expected — checks graceful handling of hazard-free content).
test(
  'structure: synthetic 1-slide minimal deck → at least one module with valid blocks',
  { skip: !HAS_KEY ? 'no ANTHROPIC_API_KEY' : false, timeout: 60_000 },
  async () => {
    const cm = await callStructure(SYNTHETIC_MINIMAL_DECK as Record<string, unknown>, 'job_eval_synth2', 'site_eval')
    assertContentModelProperties(cm as unknown, 'Synthetic minimal', { minModules: 1, minBlocks: 1 })
  },
)
