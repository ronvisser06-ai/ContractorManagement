// Pure logic test for the closed block-type set's render-time validator
// (Feature 2, Step 4) — no Supabase, no network. Proves each of the nine
// valid block shapes passes and that an unknown/malformed block returns a
// structured error instead of throwing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBlock } from '../lib/renderer/validate.ts'

const sourceRef = { slide_index: 0 }

const validBlocks: Record<string, unknown> = {
  heading: { id: 'blk_1', type: 'heading', level: 2, text: 'Title', source_ref: sourceRef },
  paragraph: { id: 'blk_2', type: 'paragraph', text: 'Body copy', source_ref: sourceRef },
  list: { id: 'blk_3', type: 'list', ordered: false, items: ['a', 'b'], source_ref: sourceRef },
  key_point: { id: 'blk_4', type: 'key_point', text: 'Remember this', source_ref: sourceRef },
  callout: { id: 'blk_5', type: 'callout', variant: 'info', title: 'Note', text: 'Heads up', source_ref: sourceRef },
  hazard: {
    id: 'blk_6',
    type: 'hazard',
    hazard: 'Falling objects',
    description: 'Hard hats required',
    severity: 'high',
    controls: [{ type: 'ppe', text: 'Wear a hard hat' }],
    source_ref: sourceRef,
  },
  image: { id: 'blk_7', type: 'image', asset_id: 'ast_1', alt: 'A photo', source_ref: sourceRef },
  video: { id: 'blk_8', type: 'video', asset_id: 'ast_2', source_ref: sourceRef },
  table: { id: 'blk_9', type: 'table', headers: ['A', 'B'], rows: [['1', '2']], source_ref: sourceRef },
}

for (const [type, block] of Object.entries(validBlocks)) {
  test(`validateBlock accepts a valid ${type} block`, () => {
    const result = validateBlock(block, 0)
    assert.equal(result.error, undefined, JSON.stringify(result.error))
    assert.equal(result.block?.type, type)
  })
}

test('validateBlock rejects an unknown block type without throwing', () => {
  const result = validateBlock({ id: 'blk_bad', type: 'carousel', slides: ['a'], source_ref: sourceRef }, 0)
  assert.equal(result.block, undefined)
  assert.match(result.error!.reason, /unknown block type: carousel/)
})

test('validateBlock rejects a block missing required fields', () => {
  const result = validateBlock({ id: 'blk_bad2', type: 'heading', source_ref: sourceRef }, 0)
  assert.equal(result.block, undefined)
  assert.match(result.error!.reason, /invalid heading fields/)
})

test('validateBlock rejects a block missing source_ref', () => {
  const result = validateBlock({ id: 'blk_bad3', type: 'paragraph', text: 'hi' }, 0)
  assert.equal(result.block, undefined)
  assert.match(result.error!.reason, /source_ref/)
})

test('validateBlock rejects a non-object', () => {
  const result = validateBlock('not a block', 0)
  assert.equal(result.block, undefined)
  assert.match(result.error!.reason, /not an object/)
})
