// Schema validation for the closed block-type set (contracts §4.3). Hand-rolled
// rather than a schema library — nine small, fixed shapes don't warrant a new
// dependency. Every block-rendering path goes through validateBlock first so an
// unknown or malformed block is reported, never thrown or rendered as raw markup.

import type {
  CalloutBlock,
  HazardBlock,
  HeadingBlock,
  ImageBlock,
  KeyPointBlock,
  ListBlock,
  ParagraphBlock,
  TableBlock,
  ValidatedBlock,
  VideoBlock,
} from '@/contracts/types'

export interface BlockValidationError {
  index: number
  blockId?: string
  reason: string
}

export type ValidateBlockResult = { block: ValidatedBlock; error?: undefined } | { block?: undefined; error: BlockValidationError }

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isNonEmptyString(v: unknown): v is string {
  return isString(v) && v.length > 0
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString)
}

function isStringRows(v: unknown): v is string[][] {
  return Array.isArray(v) && v.every(isStringArray)
}

function hasValidSourceRef(r: Record<string, unknown>): boolean {
  const ref = r.source_ref as Record<string, unknown> | undefined
  return typeof ref === 'object' && ref !== null && typeof ref.slide_index === 'number'
}

export function validateBlock(raw: unknown, index: number): ValidateBlockResult {
  if (typeof raw !== 'object' || raw === null) {
    return { error: { index, reason: 'block is not an object' } }
  }
  const r = raw as Record<string, unknown>
  const blockId = isString(r.id) ? r.id : undefined

  if (!isNonEmptyString(r.id)) {
    return { error: { index, blockId, reason: 'missing or invalid id' } }
  }
  if (!hasValidSourceRef(r)) {
    return { error: { index, blockId, reason: 'missing or invalid source_ref' } }
  }
  if (!isNonEmptyString(r.type)) {
    return { error: { index, blockId, reason: 'missing or invalid type' } }
  }

  switch (r.type) {
    case 'heading':
      if (![1, 2, 3].includes(r.level as number) || !isNonEmptyString(r.text)) {
        return { error: { index, blockId, reason: 'invalid heading fields (need level 1-3, text)' } }
      }
      return { block: r as unknown as HeadingBlock }

    case 'paragraph':
      if (!isNonEmptyString(r.text)) {
        return { error: { index, blockId, reason: 'invalid paragraph fields (need text)' } }
      }
      return { block: r as unknown as ParagraphBlock }

    case 'list':
      if (typeof r.ordered !== 'boolean' || !isStringArray(r.items) || r.items.length === 0) {
        return { error: { index, blockId, reason: 'invalid list fields (need ordered, items[])' } }
      }
      return { block: r as unknown as ListBlock }

    case 'key_point':
      if (!isNonEmptyString(r.text)) {
        return { error: { index, blockId, reason: 'invalid key_point fields (need text)' } }
      }
      return { block: r as unknown as KeyPointBlock }

    case 'callout':
      if (
        !['info', 'warning', 'critical'].includes(r.variant as string) ||
        !isNonEmptyString(r.title) ||
        !isNonEmptyString(r.text)
      ) {
        return { error: { index, blockId, reason: 'invalid callout fields (need variant, title, text)' } }
      }
      return { block: r as unknown as CalloutBlock }

    case 'hazard':
      if (
        !isNonEmptyString(r.hazard) ||
        !isNonEmptyString(r.description) ||
        !['low', 'medium', 'high', 'critical'].includes(r.severity as string) ||
        !Array.isArray(r.controls) ||
        r.controls.length === 0
      ) {
        return { error: { index, blockId, reason: 'invalid hazard fields (need hazard, description, severity, controls[])' } }
      }
      return { block: r as unknown as HazardBlock }

    case 'image':
      if (!isNonEmptyString(r.asset_id) || !isNonEmptyString(r.alt)) {
        return { error: { index, blockId, reason: 'invalid image fields (need asset_id, alt)' } }
      }
      return { block: r as unknown as ImageBlock }

    case 'video':
      if (!isNonEmptyString(r.asset_id)) {
        return { error: { index, blockId, reason: 'invalid video fields (need asset_id)' } }
      }
      return { block: r as unknown as VideoBlock }

    case 'table':
      if (!isStringArray(r.headers) || !isStringRows(r.rows)) {
        return { error: { index, blockId, reason: 'invalid table fields (need headers[], rows[][])' } }
      }
      return { block: r as unknown as TableBlock }

    default:
      return { error: { index, blockId, reason: `unknown block type: ${String(r.type)}` } }
  }
}

export function validateBlocks(raw: unknown[]): { blocks: ValidatedBlock[]; errors: BlockValidationError[] } {
  const blocks: ValidatedBlock[] = []
  const errors: BlockValidationError[] = []
  raw.forEach((item, index) => {
    const result = validateBlock(item, index)
    if (result.block) blocks.push(result.block)
    else errors.push(result.error)
  })
  return { blocks, errors }
}
