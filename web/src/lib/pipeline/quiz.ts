import Anthropic from '@anthropic-ai/sdk'
import type { ContentModel, Quiz } from '../../contracts/types.ts'

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export const QUIZ_MODEL = 'claude-sonnet-4-6'
export const QUIZ_STAGE_VERSION = 'generate_quiz@1.0.0'

const SYSTEM_PROMPT = `You are a safety orientation quiz writer. Given a ContentModel, produce a JSON Quiz that tests whether workers understood the orientation content.

## Quiz format

Return a single JSON object — no markdown fences, no explanation:

{
  "meta": {
    "pass_threshold": 0.8,
    "attempts_allowed": 3,
    "shuffle_questions": true,
    "shuffle_options": true,
    "question_count": <number — must exactly equal questions.length>
  },
  "questions": [ Question... ],
  "coverage_map": {
    "<objective_id>": ["<question_id>", ...],
    "<hazard_block_id>": ["<question_id>", ...]
  }
}

## Question format

{
  "id": "q_01",
  "module_id": "<mod_XX from ContentModel>",
  "objective_id": "<obj_XX_N from ContentModel>",
  "source_refs": ["<blk_XX_NN>", ...],
  "type": "single_choice",
  "difficulty": "recall",
  "stem": "Question text ending with a question mark?",
  "options": [
    { "id": "opt_a", "text": "Option text" },
    { "id": "opt_b", "text": "Option text" },
    { "id": "opt_c", "text": "Option text" }
  ],
  "correct_option_ids": ["opt_b"],
  "rationale": "One sentence explaining the correct answer, citing the source block ids."
}

## Rules

1. MANDATORY — Objective coverage: Write ≥1 question per learning objective. Each question must reference the objective's id in objective_id. Add the objective_id as a key in coverage_map mapping to all question ids that cover it.
2. MANDATORY — Hazard coverage: For every hazard block listed in hazard_index, write ≥1 question that cites that block's id in source_refs. Add the hazard block_id as a key in coverage_map.
3. source_refs: List only block ids (blk_XX_NN) that contain the tested content. Do not cite image or video blocks — they carry no testable text.
4. single_choice: 3–4 options, exactly 1 correct_option_id. true_false: exactly 2 options (opt_a = "True", opt_b = "False"), exactly 1 correct_option_id.
5. Distractors must be plausible but clearly wrong according to the source text. Never write a distractor that could be defended as correct from the source.
6. difficulty: "recall" — worker remembers a stated fact. "application" — worker applies a rule to a described scenario. Use a mix of both.
7. Do not invent content absent from the source blocks. Every claim in stem, options, and rationale must be traceable to a cited source_ref.
8. question_count in meta must exactly equal the length of the questions array.`

function formatContentModelForPrompt(cm: ContentModel): string {
  const lines: string[] = []
  lines.push(`title: ${cm.meta.title}`)
  lines.push(`estimated_minutes: ${cm.meta.estimated_minutes}`)
  lines.push('')

  for (const mod of cm.modules) {
    lines.push(`=== Module ${mod.id}: ${mod.title} (slides ${mod.source_slides.join(', ')}) ===`)
    lines.push('Objectives:')
    for (const obj of mod.learning_objectives) {
      lines.push(`  ${obj.id}: ${obj.text}`)
    }
    lines.push('Blocks:')
    for (const blk of mod.blocks) {
      const b = blk as Record<string, unknown>
      const prefix = `  ${blk.id} [${blk.type}]`
      switch (blk.type) {
        case 'heading':
        case 'paragraph':
        case 'key_point':
          lines.push(`${prefix} "${b.text as string}"`)
          break
        case 'list':
          lines.push(prefix)
          for (const item of (b.items as string[]) ?? []) lines.push(`    - ${item}`)
          break
        case 'callout':
          lines.push(`${prefix} [${b.variant}] ${b.title}: "${b.text}"`)
          break
        case 'hazard':
          lines.push(`${prefix} hazard="${b.hazard}" severity=${b.severity}`)
          lines.push(`    description: "${b.description}"`)
          for (const ctrl of (b.controls as Array<{ type: string; text: string }>) ?? []) {
            lines.push(`    control [${ctrl.type}]: ${ctrl.text}`)
          }
          break
        case 'image':
          lines.push(`${prefix} alt="${b.alt}"`)
          break
        case 'video':
          lines.push(`${prefix}${b.caption ? ` caption="${b.caption}"` : ''}`)
          break
        case 'table':
          lines.push(`${prefix} [${(b.headers as string[]).join(' | ')}]`)
          for (const row of (b.rows as string[][]) ?? []) lines.push(`    ${row.join(' | ')}`)
          break
        default:
          lines.push(prefix)
      }
    }
    lines.push('')
  }

  if (cm.hazard_index.length > 0) {
    lines.push('=== Hazard Index (every entry MUST be covered by ≥1 question) ===')
    for (const h of cm.hazard_index) {
      lines.push(`  ${h.block_id}: "${h.hazard}" severity=${h.severity} (module: ${h.module_id})`)
    }
  }

  return lines.join('\n')
}

export async function callQuiz(
  contentModel: ContentModel,
  jobId: string,
  siteId: string,
): Promise<Quiz> {
  if (!client) throw new Error('ANTHROPIC_API_KEY not set — cannot run generate_quiz stage')

  const userMessage = `Produce a Quiz for this safety orientation ContentModel.

job_id: "${jobId}"
site_id: "${siteId}"

${formatContentModelForPrompt(contentModel)}`

  // Retry once on validation failure — models occasionally confuse field values
  // (e.g. type: "application" instead of "single_choice"). A fresh call usually succeeds.
  let lastError: Error | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: QUIZ_MODEL,
        max_tokens: 6000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      })

      const first = response.content[0]
      if (first.type !== 'text') {
        throw new Error('generate_quiz stage: non-text response from model')
      }

      let parsed: unknown
      try {
        const text = first.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
        parsed = JSON.parse(text)
      } catch (err) {
        throw new Error(`generate_quiz stage: JSON parse failed — ${(err as Error).message}`)
      }

      return validateAndRepairQuiz(parsed, contentModel)
    } catch (err) {
      lastError = err as Error
    }
  }
  throw lastError!
}

function validateAndRepairQuiz(raw: unknown, contentModel: ContentModel): Quiz {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('generate_quiz stage: response is not an object')
  }
  const r = raw as Record<string, unknown>

  if (!r.meta || typeof r.meta !== 'object') {
    throw new Error('generate_quiz stage: missing meta field')
  }
  if (!Array.isArray(r.questions) || (r.questions as unknown[]).length === 0) {
    throw new Error('generate_quiz stage: missing or empty questions array')
  }

  // Collect all block ids from the ContentModel for source_ref validation
  const allBlockIds = new Set<string>()
  // Track block types so we can reject image/video citations (rule 3 of the system prompt)
  const blockTypes = new Map<string, string>()
  const NON_CITEABLE = new Set(['image', 'video'])
  for (const mod of contentModel.modules) {
    for (const blk of mod.blocks) {
      allBlockIds.add(blk.id)
      blockTypes.set(blk.id, blk.type)
    }
  }

  // Collect hazard block ids for coverage_map derivation
  const hazardBlockIds = new Set<string>(contentModel.hazard_index.map((h) => h.block_id))

  const errors: string[] = []

  for (const q of r.questions as Array<Record<string, unknown>>) {
    const qId = typeof q.id === 'string' && q.id ? q.id : null
    if (!qId) {
      errors.push(`question missing id: ${JSON.stringify(q).slice(0, 80)}`)
      continue
    }

    // Normalize common model mistakes for type field
    if (q.type === 'multiple_choice') q.type = 'multi_choice'
    if (q.type === 'true/false') q.type = 'true_false'

    if (q.type !== 'single_choice' && q.type !== 'multi_choice' && q.type !== 'true_false') {
      errors.push(`question ${qId}: type "${q.type}" must be single_choice|multi_choice|true_false`)
    }

    const sourceRefs = q.source_refs
    if (!Array.isArray(sourceRefs) || (sourceRefs as unknown[]).length === 0) {
      errors.push(`question ${qId}: source_refs must be non-empty`)
    } else {
      for (const ref of sourceRefs as unknown[]) {
        if (typeof ref !== 'string' || !allBlockIds.has(ref)) {
          errors.push(`question ${qId}: source_ref "${ref}" not found in ContentModel blocks`)
        }
      }
      // At least one source_ref must be a citeable (non-image/video) text block
      const hasTextRef = (sourceRefs as string[]).some(
        (ref) => allBlockIds.has(ref) && !NON_CITEABLE.has(blockTypes.get(ref) ?? ''),
      )
      if (!hasTextRef) {
        errors.push(
          `question ${qId}: source_refs must include ≥1 text block (not only image/video blocks)`,
        )
      }
    }

    const options = q.options
    if (!Array.isArray(options) || (options as unknown[]).length < 2) {
      errors.push(`question ${qId}: options must have ≥2 entries`)
    } else {
      const optIds = new Set((options as Array<Record<string, unknown>>).map((o) => o.id as string))
      const correctIds = q.correct_option_ids
      if (!Array.isArray(correctIds) || (correctIds as unknown[]).length === 0) {
        errors.push(`question ${qId}: correct_option_ids must be non-empty`)
      } else {
        for (const cid of correctIds as unknown[]) {
          if (!optIds.has(cid as string)) {
            errors.push(`question ${qId}: correct_option_id "${cid}" not found in options`)
          }
        }
      }
    }

    if (typeof q.rationale !== 'string' || !q.rationale) {
      errors.push(`question ${qId}: rationale required`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`generate_quiz stage: validation errors:\n${errors.slice(0, 10).join('\n')}`)
  }

  // Derive coverage_map from questions when the model omitted or left it empty.
  // Keys: objective_ids (from objective_id field) + hazard block_ids (from source_refs).
  const derivedMap: Record<string, string[]> = {}
  for (const q of r.questions as Array<Record<string, unknown>>) {
    const objId = q.objective_id as string | undefined
    if (objId) {
      if (!derivedMap[objId]) derivedMap[objId] = []
      derivedMap[objId].push(q.id as string)
    }
    for (const ref of (q.source_refs as string[]) ?? []) {
      if (hazardBlockIds.has(ref)) {
        if (!derivedMap[ref]) derivedMap[ref] = []
        derivedMap[ref].push(q.id as string)
      }
    }
  }

  const existingMap = r.coverage_map as Record<string, unknown> | undefined
  if (!existingMap || Object.keys(existingMap).length === 0) {
    r.coverage_map = derivedMap
  }

  // Ensure question_count matches actual questions length
  const meta = r.meta as Record<string, unknown>
  meta.question_count = (r.questions as unknown[]).length

  return r as unknown as Quiz
}
