import Anthropic from '@anthropic-ai/sdk'
import type { ContentModel, Branding } from '../../contracts/types.ts'
import { validateBlocks } from '../renderer/validate.ts'

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

export const STRUCTURE_MODEL = 'claude-sonnet-4-6'
export const STRUCTURE_STAGE_VERSION = 'structure@1.0.0'

const SYSTEM_PROMPT = `You are a safety orientation content structurer. Convert the extracted slide deck into a semantic ContentModel JSON document.

## ContentModel format

Return a single JSON object — no markdown fences, no explanation:

{
  "meta": { "title": string, "site_id": string, "language": "en", "estimated_minutes": number, "reading_level": "grade_8" },
  "branding": { <copy from deck> },
  "modules": [ Module... ],
  "hazard_index": [ { "block_id": string, "module_id": string, "hazard": string, "severity": string }... ]
}

Module schema:
{
  "id": "mod_01",
  "order": 1,
  "title": string,
  "source_slides": [N...],
  "learning_objectives": [ { "id": "obj_01_1", "text": string, "source_block_ids": [block_id...] } ],
  "blocks": [ ContentBlock... ]
}

## Block types — CLOSED SET — use ONLY these 9 types. Never emit HTML or custom types.

Every block must have: "id" (format: blk_MM_NN), "type", and "source_ref": { "slide_index": N }

- heading:   { "level": 1|2|3, "text": string }
- paragraph: { "text": string }
- list:      { "ordered": boolean, "items": [string...] }
- key_point: { "text": string }                                           — critical safety rule or takeaway
- callout:   { "variant": "info"|"warning"|"critical", "title": string, "text": string }
- hazard:    { "hazard": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "controls": [{ "type": "engineering"|"administrative"|"ppe", "text": string }] }
- image:     { "asset_id": string, "alt": string, "caption"?: string }    — only when slide has [IMAGE: id]
- video:     { "asset_id": string, "caption"?: string }                   — only when slide has [VIDEO: id]
- table:     { "headers": [string...], "rows": [[string...]], "caption"?: string }

## Rules

1. Group slides by safety topic. Each module covers one coherent topic (e.g. PPE, Confined Space, Emergency Response).
2. Every block MUST have source_ref.slide_index matching the slide it came from.
3. Use hazard blocks for any hazard, risk, or dangerous condition. Use callout for procedural alerts and notices.
4. Every hazard block MUST appear in hazard_index.
5. Every module MUST have at least one learning_objective citing the block_ids it addresses.
6. estimated_minutes = realistic time for a worker to read and watch everything (not slide count / 2).
7. Keep block text faithful to source — do not paraphrase or editorialize.`

function formatDeckForPrompt(deck: Record<string, unknown>): string {
  const slides = (deck.slides as Array<Record<string, unknown>>) ?? []
  const parts: string[] = []

  for (const slide of slides) {
    const runs = (slide.text_runs as Array<Record<string, unknown>>) ?? []
    const tables = (slide.tables as Array<Record<string, unknown>>) ?? []
    const imageIds = (slide.image_asset_ids as string[]) ?? []
    const mediaIds = (slide.media_asset_ids as string[]) ?? []
    const notes = slide.speaker_notes as string | null | undefined

    const lines: string[] = [`--- Slide ${slide.index}: ${slide.title ?? '(no title)'} ---`]

    for (const run of runs) {
      const level = typeof run.level === 'number' ? (run.level as number) : 0
      const indent = '  '.repeat(level)
      const bold = run.bold ? '**' : ''
      lines.push(`${indent}${bold}${run.text}${bold}`)
    }

    for (const tbl of tables) {
      const headers = tbl.headers as string[]
      const rows = (tbl.rows as string[][]) ?? []
      lines.push(`[TABLE: ${headers.join(' | ')}]`)
      for (const row of rows) {
        lines.push(`  ${row.join(' | ')}`)
      }
    }

    for (const id of imageIds) lines.push(`[IMAGE: ${id}]`)
    for (const id of mediaIds) lines.push(`[VIDEO: ${id}]`)

    if (notes) {
      const truncated = notes.length > 300 ? `${notes.slice(0, 300)}…` : notes
      lines.push(`[NOTE: ${truncated}]`)
    }

    parts.push(lines.join('\n'))
  }

  return parts.join('\n\n')
}

export async function callStructure(
  deck: Record<string, unknown>,
  jobId: string,
  siteId: string,
): Promise<ContentModel> {
  if (!client) throw new Error('ANTHROPIC_API_KEY not set — cannot run structure stage')

  const source = deck.source as Record<string, unknown> | undefined
  const branding = deck.branding as Branding | undefined
  const deckText = formatDeckForPrompt(deck)

  const userMessage = `Convert this safety orientation slide deck to a ContentModel.

site_id: "${siteId}"
job_id: "${jobId}"
slide_count: ${source?.slide_count ?? 'unknown'}
branding: ${JSON.stringify(branding ?? {})}

${deckText}`

  const response = await client.messages.create({
    model: STRUCTURE_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const first = response.content[0]
  if (first.type !== 'text') {
    throw new Error('structure stage: non-text response from model')
  }

  let parsed: unknown
  try {
    const text = first.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`structure stage: JSON parse failed — ${(err as Error).message}`)
  }

  return validateAndRepair(parsed, siteId, branding)
}

function validateAndRepair(raw: unknown, siteId: string, branding: Branding | undefined): ContentModel {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('structure stage: response is not an object')
  }
  const r = raw as Record<string, unknown>

  if (!r.meta || typeof r.meta !== 'object') {
    throw new Error('structure stage: missing meta field')
  }
  if (!Array.isArray(r.modules) || r.modules.length === 0) {
    throw new Error('structure stage: missing or empty modules array')
  }

  // Override site_id and branding — never trust the model on these
  const meta = r.meta as Record<string, unknown>
  meta.site_id = siteId
  if (branding) r.branding = branding

  // Validate all blocks via the renderer's closed-set validator
  const allErrors: string[] = []
  for (const mod of r.modules as Array<Record<string, unknown>>) {
    if (!mod.id || typeof mod.id !== 'string') {
      allErrors.push(`module missing id: ${JSON.stringify(mod).slice(0, 80)}`)
      continue
    }
    if (!mod.title || !Array.isArray(mod.blocks)) {
      allErrors.push(`module ${mod.id}: missing title or blocks`)
      continue
    }
    const { errors } = validateBlocks(mod.blocks as unknown[])
    for (const e of errors) {
      allErrors.push(`module ${mod.id} block[${e.index}] ${e.blockId ?? ''}: ${e.reason}`)
    }
  }

  if (allErrors.length > 0) {
    throw new Error(`structure stage: block validation errors:\n${allErrors.slice(0, 15).join('\n')}`)
  }

  // Rebuild hazard_index from modules if model omitted it or left it empty —
  // QA stage depends on this being complete.
  const derived: Array<Record<string, unknown>> = []
  for (const mod of r.modules as Array<Record<string, unknown>>) {
    for (const blk of (mod.blocks as Array<Record<string, unknown>>) ?? []) {
      if (blk.type === 'hazard') {
        derived.push({
          block_id: blk.id,
          module_id: mod.id,
          hazard: blk.hazard,
          severity: blk.severity,
        })
      }
    }
  }

  if (!Array.isArray(r.hazard_index) || r.hazard_index.length === 0) {
    r.hazard_index = derived
  }

  return r as unknown as ContentModel
}
