import Anthropic from '@anthropic-ai/sdk'
import type { ContentModel, ContentBlock, Quiz, QAVerdict } from '../../contracts/types.ts'

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export const QA_MODEL = 'claude-opus-4-8'
export const QA_STAGE_VERSION = 'qa_review@1.0.0'

const SYSTEM_PROMPT = `You are a QA evaluator for safety orientation content. Given three artifacts — an extracted slide deck, a structured ContentModel, and a Quiz — evaluate the pipeline output for quality and safety accuracy.

## What you evaluate

**Coverage** (0.0–1.0): Does the Quiz cover every learning objective and every critical/high hazard?
- An objective is covered if ≥1 question has that objective's id in objective_id.
- A hazard is covered if ≥1 question cites the hazard block_id in source_refs.
- Score = (covered objectives + covered hazards) / (total objectives + total hazards). If no objectives or hazards exist, score = 1.0.
- Pass threshold: ≥ 0.90

**Correctness** (0.0–1.0): Are all quiz answers verifiably correct from their cited source blocks?
- For each question, read ONLY the source blocks cited in source_refs.
- Check that every correct_option_id is unambiguously supported by the source text.
- Check that no incorrect option could be defended as correct from the same source text.
- Check that the rationale accurately describes the correct answer.
- Score = questions with zero correctness issues / total questions.
- Pass threshold: ≥ 0.95 (a wrong answer on safety content is dangerous)

**Fidelity** (0.0–1.0): Does the ContentModel faithfully represent the source deck?
- Check for invented facts absent from the source slides.
- Check for significant omissions of safety-critical content from the slides.
- Check that block types are appropriate for their content.
- Score = blocks without fidelity issues / total blocks.
- Pass threshold: ≥ 0.90

## Issue severity rules

- **blocker**: A wrong correct answer on safety content; completely missing coverage of a critical hazard; content model fabricates a safety rule not in the source.
- **major**: A coverage gap for a learning objective; a distractor option that could plausibly be defended as correct; fidelity issue that materially changes the meaning of a safety rule.
- **minor**: Ambiguous phrasing; sub-optimal distractor quality; minor omissions of non-critical content.

## Verdict rules

1. verdict = "pass" ONLY when ALL three scores meet their pass threshold AND there are no blocker or major issues.
2. verdict = "needs_rework" if any score fails its threshold or any blocker/major issue exists.
3. routed_to = "structure" if any issue has target_stage="structure"; "generate_quiz" if issues only target generate_quiz; "none" if verdict=pass. When issues span both stages, use "structure" (upstream fixes may resolve downstream issues).
4. Do not flag minor stylistic variation in wording. Only flag genuine factual errors or safety-critical gaps.
5. Do not invent issues. Every issue must be traceable to a specific source text excerpt vs. the quiz/model content.

## Output format

Return a single JSON object — no markdown fences, no explanation:

{
  "verdict": "pass" | "needs_rework",
  "scores": {
    "coverage":    { "value": 0.0–1.0, "pass": true|false },
    "correctness": { "value": 0.0–1.0, "pass": true|false },
    "fidelity":    { "value": 0.0–1.0, "pass": true|false }
  },
  "issues": [
    {
      "id": "iss_01",
      "severity": "blocker" | "major" | "minor",
      "category": "coverage" | "correctness" | "fidelity" | "accessibility",
      "target_stage": "structure" | "generate_quiz",
      "target_ref": "<block_id or question_id>",
      "description": "Specific, traceable description of the problem.",
      "suggested_fix": "Specific, actionable fix."
    }
  ],
  "routed_to": "structure" | "generate_quiz" | "none"
}`

function formatExtractedDeck(deck: Record<string, unknown>): string {
  const slides = (deck.slides as Array<Record<string, unknown>>) ?? []
  const parts: string[] = []
  for (const slide of slides) {
    const runs = (slide.text_runs as Array<Record<string, unknown>>) ?? []
    const tables = (slide.tables as Array<Record<string, unknown>>) ?? []
    const notes = slide.speaker_notes as string | null | undefined
    const lines: string[] = [`--- Slide ${slide.index}: ${slide.title ?? '(no title)'} ---`]
    for (const run of runs) {
      const level = typeof run.level === 'number' ? (run.level as number) : 0
      lines.push(`${'  '.repeat(level)}${run.text}`)
    }
    for (const tbl of tables) {
      const headers = tbl.headers as string[]
      const rows = (tbl.rows as string[][]) ?? []
      lines.push(`[TABLE: ${headers.join(' | ')}]`)
      for (const row of rows) lines.push(`  ${row.join(' | ')}`)
    }
    if (notes) {
      const n = notes.length > 200 ? `${notes.slice(0, 200)}…` : notes
      lines.push(`[NOTE: ${n}]`)
    }
    parts.push(lines.join('\n'))
  }
  return parts.join('\n\n')
}

function buildBlockIndex(contentModel: ContentModel): Map<string, ContentBlock> {
  const index = new Map<string, ContentBlock>()
  for (const mod of contentModel.modules) {
    for (const blk of mod.blocks) index.set(blk.id, blk)
  }
  return index
}

function renderBlockText(blk: ContentBlock): string {
  const b = blk as Record<string, unknown>
  switch (blk.type) {
    case 'heading':
    case 'paragraph':
    case 'key_point':
      return `"${b.text}"`
    case 'list':
      return (b.items as string[]).map((i) => `- ${i}`).join(' ')
    case 'callout':
      return `[${b.variant}] ${b.title}: "${b.text}"`
    case 'hazard':
      return `hazard="${b.hazard}" severity=${b.severity}: "${b.description}"`
    case 'table':
      return `table [${(b.headers as string[]).join(' | ')}]`
    default:
      return `[${blk.type}]`
  }
}

function formatContentModelCompact(cm: ContentModel): string {
  const lines: string[] = []
  for (const mod of cm.modules) {
    const slides = mod.source_slides.join(', ')
    lines.push(`=== Module ${mod.id}: ${mod.title} (slides ${slides}) ===`)
    for (const obj of mod.learning_objectives) {
      lines.push(`  Objective ${obj.id}: ${obj.text}`)
    }
    for (const blk of mod.blocks) {
      const sr = blk.source_ref as unknown as Record<string, unknown>
      lines.push(`  ${blk.id} [${blk.type}] slide=${sr.slide_index}: ${renderBlockText(blk)}`)
    }
    lines.push('')
  }
  if (cm.hazard_index.length > 0) {
    lines.push('=== Hazard Index ===')
    for (const h of cm.hazard_index) {
      lines.push(`  ${h.block_id}: "${h.hazard}" severity=${h.severity} (module ${h.module_id})`)
    }
  }
  return lines.join('\n')
}

function formatQuizForEvaluation(quiz: Quiz, blockIndex: Map<string, ContentBlock>): string {
  const lines: string[] = []
  lines.push(
    `Meta: pass_threshold=${quiz.meta.pass_threshold}, attempts_allowed=${quiz.meta.attempts_allowed}, question_count=${quiz.meta.question_count}`,
  )
  lines.push('')
  for (const q of quiz.questions) {
    lines.push(`Q ${q.id} [${q.type} / ${q.difficulty}] module=${q.module_id} objective=${q.objective_id}`)
    lines.push(`  Source blocks (the ONLY authoritative text for this question):`)
    for (const ref of q.source_refs) {
      const blk = blockIndex.get(ref)
      if (blk) {
        lines.push(`    ${ref} [${blk.type}]: ${renderBlockText(blk)}`)
      } else {
        lines.push(`    ${ref}: (block not found in ContentModel)`)
      }
    }
    lines.push(`  Stem: ${q.stem}`)
    lines.push(`  Options:`)
    for (const opt of q.options) {
      const correct = q.correct_option_ids.includes(opt.id)
      lines.push(`    ${opt.id}: ${opt.text}${correct ? '  ← MARKED CORRECT' : ''}`)
    }
    lines.push(`  Rationale: "${q.rationale}"`)
    lines.push('')
  }
  lines.push('=== Coverage Map ===')
  for (const [key, qIds] of Object.entries(quiz.coverage_map)) {
    lines.push(`  ${key}: [${(qIds as string[]).join(', ')}]`)
  }
  return lines.join('\n')
}

export async function callQA(
  extractedDeck: Record<string, unknown>,
  contentModel: ContentModel,
  quiz: Quiz,
  jobId: string,
  siteId: string,
  reworkCount: number = 0,
  maxRework: number = 3,
): Promise<QAVerdict> {
  if (!client) throw new Error('ANTHROPIC_API_KEY not set — cannot run qa_review stage')

  const blockIndex = buildBlockIndex(contentModel)

  const userMessage = `Evaluate this safety orientation pipeline output.

job_id: "${jobId}"
site_id: "${siteId}"

=== EXTRACTED SOURCE DECK ===
${formatExtractedDeck(extractedDeck)}

=== CONTENT MODEL ===
${formatContentModelCompact(contentModel)}

=== QUIZ (evaluate for coverage, correctness, fidelity) ===
${formatQuizForEvaluation(quiz, blockIndex)}`

  const response = await client.messages.create({
    model: QA_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const first = response.content[0]
  if (first.type !== 'text') {
    throw new Error('qa_review stage: non-text response from model')
  }

  let parsed: unknown
  try {
    const raw = first.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    // Opus may emit preamble text before the JSON object — extract it by position
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    const text = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`qa_review stage: JSON parse failed — ${(err as Error).message}`)
  }

  return validateAndRepairVerdict(parsed, reworkCount, maxRework)
}

function validateAndRepairVerdict(raw: unknown, reworkCount: number, maxRework: number): QAVerdict {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('qa_review stage: response is not an object')
  }
  const r = raw as Record<string, unknown>

  if (r.verdict !== 'pass' && r.verdict !== 'needs_rework') {
    throw new Error(`qa_review stage: verdict must be pass|needs_rework, got "${r.verdict}"`)
  }

  const scores = r.scores as Record<string, unknown> | undefined
  if (!scores || typeof scores !== 'object') {
    throw new Error('qa_review stage: missing scores')
  }
  for (const dim of ['coverage', 'correctness', 'fidelity'] as const) {
    const s = scores[dim] as Record<string, unknown> | undefined
    if (!s || typeof s !== 'object') {
      throw new Error(`qa_review stage: missing scores.${dim}`)
    }
    if (typeof s.value !== 'number' || s.value < 0 || s.value > 1) {
      throw new Error(`qa_review stage: scores.${dim}.value must be 0.0–1.0, got ${s.value}`)
    }
    if (typeof s.pass !== 'boolean') {
      throw new Error(`qa_review stage: scores.${dim}.pass must be boolean`)
    }
  }

  if (!Array.isArray(r.issues)) r.issues = []

  const errors: string[] = []
  for (const iss of r.issues as Array<Record<string, unknown>>) {
    const issId = typeof iss.id === 'string' && iss.id ? iss.id : null
    if (!issId) {
      errors.push(`issue missing id: ${JSON.stringify(iss).slice(0, 60)}`)
      continue
    }
    if (!['blocker', 'major', 'minor'].includes(iss.severity as string)) {
      errors.push(`issue ${issId}: severity must be blocker|major|minor, got "${iss.severity}"`)
    }
    if (!['coverage', 'correctness', 'fidelity', 'accessibility'].includes(iss.category as string)) {
      errors.push(`issue ${issId}: category must be coverage|correctness|fidelity|accessibility, got "${iss.category}"`)
    }
    if (!['structure', 'generate_quiz'].includes(iss.target_stage as string)) {
      errors.push(`issue ${issId}: target_stage must be structure|generate_quiz, got "${iss.target_stage}"`)
    }
    if (!iss.target_ref || typeof iss.target_ref !== 'string') {
      errors.push(`issue ${issId}: target_ref required`)
    }
    if (!iss.description || typeof iss.description !== 'string') {
      errors.push(`issue ${issId}: description required`)
    }
    if (!iss.suggested_fix || typeof iss.suggested_fix !== 'string') {
      errors.push(`issue ${issId}: suggested_fix required`)
    }
  }
  if (errors.length > 0) {
    throw new Error(`qa_review stage: issue validation errors:\n${errors.slice(0, 10).join('\n')}`)
  }

  // Normalize common model alias for routed_to
  if (r.routed_to === 'quiz') r.routed_to = 'generate_quiz'

  if (!['structure', 'generate_quiz', 'none'].includes(r.routed_to as string)) {
    const issues = r.issues as Array<Record<string, unknown>>
    const hasStructure = issues.some((i) => i.target_stage === 'structure')
    const hasQuiz = issues.some((i) => i.target_stage === 'generate_quiz')
    r.routed_to = hasStructure ? 'structure' : hasQuiz ? 'generate_quiz' : 'none'
  }

  // Repair: if the model says pass but there are blocker/major issues, flip verdict
  const issues = r.issues as Array<Record<string, unknown>>
  const hasBlockerOrMajor = issues.some((i) => i.severity === 'blocker' || i.severity === 'major')
  if (r.verdict === 'pass' && hasBlockerOrMajor) {
    r.verdict = 'needs_rework'
  }

  // If verdict=pass, routed_to must be none
  if (r.verdict === 'pass') r.routed_to = 'none'

  r.decision = deriveReworkDecision(r.verdict as 'pass' | 'needs_rework', reworkCount, maxRework)
  r.rework_count = reworkCount
  r.max_rework = maxRework

  return r as unknown as QAVerdict
}

// Pure routing function — exported so the orchestrator and tests can verify
// the decision logic without making API calls.
export function deriveReworkDecision(
  verdict: 'pass' | 'needs_rework',
  reworkCount: number,
  maxRework: number,
): 'proceed' | 'rework' | 'escalate' {
  if (verdict === 'pass') return 'proceed'
  return reworkCount < maxRework ? 'rework' : 'escalate'
}
