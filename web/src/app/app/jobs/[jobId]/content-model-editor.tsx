'use client'

// Bounded content-model block editor (contracts §7).
// Allowed: edit block text fields; reorder/delete blocks and modules;
//          insert a block from the closed block-type set.
// Excluded: fonts/colors, raw HTML/markup, new block types, free canvas.
// Block id and source_ref are preserved on all edits (§7 invariant).

import { useState, useTransition } from 'react'
import { ChevronUp, ChevronDown, Trash2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContentModelView } from '@/components/renderer/ContentModelView'
import { validateBlock } from '@/lib/renderer/validate'
import type { BlockType, ContentBlock, ContentModel } from '@/contracts/types'
import { saveContentModelEdits } from './actions'

// ── Block-type metadata ────────────────────────────────────────────────────────

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  key_point: 'Key Point',
  callout: 'Callout',
  list: 'List',
  hazard: 'Hazard',
  image: 'Image',
  video: 'Video',
  table: 'Table',
}

const ALL_BLOCK_TYPES: BlockType[] = [
  'heading', 'paragraph', 'key_point', 'callout', 'list',
  'hazard', 'image', 'video', 'table',
]

function genBlockId(): string {
  return `blk_human_${Math.random().toString(36).slice(2, 10)}`
}

function makeDefaultBlock(type: BlockType): ContentBlock {
  const id = genBlockId()
  const source_ref = { slide_index: 0 }
  switch (type) {
    case 'heading':
      return { id, type, source_ref, level: 2, text: 'New heading' } as ContentBlock
    case 'paragraph':
      return { id, type, source_ref, text: 'New paragraph.' } as ContentBlock
    case 'key_point':
      return { id, type, source_ref, text: 'New key point.' } as ContentBlock
    case 'callout':
      return { id, type, source_ref, variant: 'info', title: 'Note', text: 'New callout.' } as ContentBlock
    case 'list':
      return { id, type, source_ref, ordered: false, items: ['Item 1'] } as ContentBlock
    case 'hazard':
      return {
        id, type, source_ref,
        hazard: 'Hazard name',
        description: 'Hazard description.',
        severity: 'medium',
        controls: [{ type: 'administrative', text: 'Control measure.' }],
      } as ContentBlock
    case 'image':
      return { id, type, source_ref, asset_id: '', alt: '' } as ContentBlock
    case 'video':
      return { id, type, source_ref, asset_id: '' } as ContentBlock
    case 'table':
      return {
        id, type, source_ref,
        headers: ['Column 1', 'Column 2'],
        rows: [['Cell 1', 'Cell 2']],
      } as ContentBlock
  }
}

// ── Shared input class strings ─────────────────────────────────────────────────

const INPUT = 'w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring'
const TEXTAREA = `${INPUT} resize-y`

// ── BlockFields — per-type text editor ────────────────────────────────────────

function BlockFields({
  block,
  onChange,
}: {
  block: ContentBlock
  onChange: (updates: Record<string, unknown>) => void
}) {
  const r = block as Record<string, unknown>

  switch (block.type) {
    case 'heading':
      return (
        <div className="space-y-1.5">
          <select
            className={INPUT}
            value={r.level as number}
            onChange={(e) => onChange({ level: Number(e.target.value) })}
            aria-label="Heading level"
          >
            <option value={1}>H1 — large</option>
            <option value={2}>H2 — medium</option>
            <option value={3}>H3 — small</option>
          </select>
          <input
            className={INPUT}
            value={r.text as string}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Heading text"
          />
        </div>
      )

    case 'paragraph':
      return (
        <textarea
          className={TEXTAREA}
          rows={3}
          value={r.text as string}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Paragraph text"
        />
      )

    case 'key_point':
      return (
        <textarea
          className={TEXTAREA}
          rows={2}
          value={r.text as string}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Key point text"
        />
      )

    case 'callout':
      return (
        <div className="space-y-1.5">
          <select
            className={INPUT}
            value={r.variant as string}
            onChange={(e) => onChange({ variant: e.target.value })}
            aria-label="Callout variant"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <input
            className={INPUT}
            value={r.title as string}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Callout title"
          />
          <textarea
            className={TEXTAREA}
            rows={2}
            value={r.text as string}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Callout body text"
          />
        </div>
      )

    case 'list': {
      const items = r.items as string[]
      return (
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={r.ordered as boolean}
              onChange={(e) => onChange({ ordered: e.target.checked })}
            />
            Ordered (numbered) list
          </label>
          <textarea
            className={TEXTAREA}
            rows={Math.max(3, items.length + 1)}
            value={items.join('\n')}
            onChange={(e) => onChange({ items: e.target.value.split('\n') })}
            placeholder="One item per line"
          />
          <p className="text-xs text-muted-foreground">One item per line.</p>
        </div>
      )
    }

    case 'hazard': {
      const controls = r.controls as Array<{ type: string; text: string }>
      return (
        <div className="space-y-2">
          <input
            className={INPUT}
            value={r.hazard as string}
            onChange={(e) => onChange({ hazard: e.target.value })}
            placeholder="Hazard name"
          />
          <textarea
            className={TEXTAREA}
            rows={2}
            value={r.description as string}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Hazard description"
          />
          <select
            className={INPUT}
            value={r.severity as string}
            onChange={(e) => onChange({ severity: e.target.value })}
            aria-label="Severity"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Controls ({controls.length})</p>
            {controls.map((ctrl, ci) => (
              <div key={ci} className="flex items-center gap-1.5">
                <select
                  className="shrink-0 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  value={ctrl.type}
                  onChange={(e) => {
                    const next = controls.map((c, i) => (i !== ci ? c : { ...c, type: e.target.value }))
                    onChange({ controls: next })
                  }}
                  aria-label={`Control ${ci + 1} type`}
                >
                  <option value="engineering">Engineering</option>
                  <option value="administrative">Administrative</option>
                  <option value="ppe">PPE</option>
                </select>
                <input
                  className="flex-1 min-w-0 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  value={ctrl.text}
                  onChange={(e) => {
                    const next = controls.map((c, i) => (i !== ci ? c : { ...c, text: e.target.value }))
                    onChange({ controls: next })
                  }}
                  placeholder="Control measure description"
                />
                <button
                  type="button"
                  onClick={() => onChange({ controls: controls.filter((_, i) => i !== ci) })}
                  aria-label="Remove control"
                  className="shrink-0 rounded p-1 text-destructive hover:bg-destructive/10"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() =>
                onChange({ controls: [...controls, { type: 'administrative', text: '' }] })
              }
            >
              + Add control
            </button>
          </div>
        </div>
      )
    }

    case 'image':
      return (
        <div className="space-y-1.5">
          <input
            className={INPUT}
            value={r.asset_id as string}
            onChange={(e) => onChange({ asset_id: e.target.value })}
            placeholder="Asset ID"
          />
          <input
            className={INPUT}
            value={r.alt as string}
            onChange={(e) => onChange({ alt: e.target.value })}
            placeholder="Alt text (required)"
          />
          <input
            className={INPUT}
            value={(r.caption as string | undefined) ?? ''}
            onChange={(e) => onChange({ caption: e.target.value || undefined })}
            placeholder="Caption (optional)"
          />
        </div>
      )

    case 'video':
      return (
        <div className="space-y-1.5">
          <input
            className={INPUT}
            value={r.asset_id as string}
            onChange={(e) => onChange({ asset_id: e.target.value })}
            placeholder="Asset ID"
          />
          <input
            className={INPUT}
            value={(r.caption as string | undefined) ?? ''}
            onChange={(e) => onChange({ caption: e.target.value || undefined })}
            placeholder="Caption (optional)"
          />
        </div>
      )

    case 'table': {
      const headers = r.headers as string[]
      const rows = r.rows as string[][]
      return (
        <div className="space-y-2 overflow-x-auto">
          <p className="text-xs font-medium text-muted-foreground">Headers</p>
          <div className="flex gap-1.5">
            {headers.map((h, hi) => (
              <input
                key={hi}
                className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                value={h}
                onChange={(e) => {
                  const next = headers.map((v, i) => (i !== hi ? v : e.target.value))
                  onChange({ headers: next })
                }}
                placeholder={`Col ${hi + 1}`}
              />
            ))}
            <button
              type="button"
              className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-muted"
              onClick={() => {
                onChange({
                  headers: [...headers, `Column ${headers.length + 1}`],
                  rows: rows.map((row) => [...row, '']),
                })
              }}
            >
              + Col
            </button>
          </div>
          <p className="text-xs font-medium text-muted-foreground">Rows</p>
          {rows.map((row, ri) => (
            <div key={ri} className="flex items-center gap-1.5">
              {row.map((cell, ci) => (
                <input
                  key={ci}
                  className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  value={cell}
                  onChange={(e) => {
                    const next = rows.map((r2, rj) =>
                      rj !== ri ? r2 : r2.map((c, cj) => (cj !== ci ? c : e.target.value)),
                    )
                    onChange({ rows: next })
                  }}
                  placeholder={`R${ri + 1}C${ci + 1}`}
                />
              ))}
              <button
                type="button"
                className="shrink-0 rounded p-1 text-destructive hover:bg-destructive/10"
                onClick={() => onChange({ rows: rows.filter((_, i) => i !== ri) })}
                aria-label="Delete row"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onChange({ rows: [...rows, headers.map(() => '')] })}
          >
            + Add row
          </button>
          <input
            className={INPUT}
            value={(r.caption as string | undefined) ?? ''}
            onChange={(e) => onChange({ caption: e.target.value || undefined })}
            placeholder="Caption (optional)"
          />
        </div>
      )
    }

    default:
      return (
        <p className="text-xs text-muted-foreground">
          Unknown block type: {block.type} — cannot edit
        </p>
      )
  }
}

// ── InsertSlot — toggle between button and form ────────────────────────────────

interface InsertPos {
  moduleIdx: number
  afterBlockIdx: number // -1 = before first block; n = after block n
}

function InsertSlot({
  moduleIdx,
  afterBlockIdx,
  openPos,
  insertType,
  onOpen,
  onTypeChange,
  onConfirm,
  onCancel,
}: {
  moduleIdx: number
  afterBlockIdx: number
  openPos: InsertPos | null
  insertType: BlockType
  onOpen: () => void
  onTypeChange: (t: BlockType) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const isOpen = openPos?.moduleIdx === moduleIdx && openPos?.afterBlockIdx === afterBlockIdx
  if (isOpen) {
    return (
      <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="flex-1 rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={insertType}
            onChange={(e) => onTypeChange(e.target.value as BlockType)}
            aria-label="Block type to insert"
          >
            {ALL_BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {BLOCK_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={onConfirm}>
            Insert
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-center py-0.5">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Insert block here"
        className="flex items-center gap-1 rounded border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <Plus className="size-3" />
        Insert block
      </button>
    </div>
  )
}

// ── ContentModelEditor — top-level client component ───────────────────────────

interface Props {
  jobId: string
  initialCm: ContentModel
  canEdit: boolean
}

export function ContentModelEditor({ jobId, initialCm, canEdit }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ContentModel>(initialCm)
  const [savedCm, setSavedCm] = useState<ContentModel>(initialCm)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [insertPos, setInsertPos] = useState<InsertPos | null>(null)
  const [insertType, setInsertType] = useState<BlockType>('paragraph')
  const [isPending, startTransition] = useTransition()

  // ── View mode ──────────────────────────────────────────────────────────────

  if (!editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Content</h3>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(savedCm)
                setEditing(true)
              }}
            >
              Edit content
            </Button>
          )}
        </div>
        <div className="rounded-md border">
          <ContentModelView contentModel={savedCm} assetUrls={{}} />
        </div>
      </div>
    )
  }

  // ── Edit helpers ───────────────────────────────────────────────────────────

  function setModuleTitle(mi: number, title: string) {
    setDraft((p) => ({
      ...p,
      modules: p.modules.map((m, i) => (i !== mi ? m : { ...m, title })),
    }))
  }

  function moveModule(mi: number, dir: 'up' | 'down') {
    const mods = [...draft.modules]
    const to = dir === 'up' ? mi - 1 : mi + 1
    if (to < 0 || to >= mods.length) return
    ;[mods[mi], mods[to]] = [mods[to], mods[mi]]
    setDraft((p) => ({ ...p, modules: mods }))
  }

  function deleteModule(mi: number) {
    if (!window.confirm(`Delete module "${draft.modules[mi].title}" and all its blocks?`)) return
    setDraft((p) => ({ ...p, modules: p.modules.filter((_, i) => i !== mi) }))
  }

  function moveBlock(mi: number, bi: number, dir: 'up' | 'down') {
    const blocks = [...draft.modules[mi].blocks]
    const to = dir === 'up' ? bi - 1 : bi + 1
    if (to < 0 || to >= blocks.length) return
    ;[blocks[bi], blocks[to]] = [blocks[to], blocks[bi]]
    setDraft((p) => ({
      ...p,
      modules: p.modules.map((m, i) => (i !== mi ? m : { ...m, blocks })),
    }))
  }

  function deleteBlock(mi: number, bi: number) {
    setDraft((p) => ({
      ...p,
      modules: p.modules.map((m, i) =>
        i !== mi ? m : { ...m, blocks: m.blocks.filter((_, j) => j !== bi) },
      ),
    }))
  }

  function updateBlock(mi: number, bi: number, updates: Record<string, unknown>) {
    setDraft((p) => ({
      ...p,
      modules: p.modules.map((m, i) =>
        i !== mi
          ? m
          : {
              ...m,
              blocks: m.blocks.map((b, j) =>
                j !== bi ? b : ({ ...b, ...updates } as ContentBlock),
              ),
            },
      ),
    }))
  }

  function commitInsert() {
    if (!insertPos) return
    const newBlock = makeDefaultBlock(insertType)
    const { moduleIdx, afterBlockIdx } = insertPos
    setDraft((p) => ({
      ...p,
      modules: p.modules.map((m, i) => {
        if (i !== moduleIdx) return m
        const blocks = [...m.blocks]
        blocks.splice(afterBlockIdx + 1, 0, newBlock)
        return { ...m, blocks }
      }),
    }))
    setInsertPos(null)
  }

  // ── Validation + save ──────────────────────────────────────────────────────

  function handleSave() {
    const errors: string[] = []
    draft.modules.forEach((mod, mi) => {
      if (!mod.title.trim()) errors.push(`Module ${mi + 1}: title is required`)
      mod.blocks.forEach((blk, bi) => {
        const result = validateBlock(blk, bi)
        if (result.error) {
          errors.push(`Module "${mod.title}" › block ${bi + 1}: ${result.error.reason}`)
        }
      })
    })
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }
    setValidationErrors([])
    setSaveError(null)
    startTransition(async () => {
      const result = await saveContentModelEdits(jobId, draft)
      if (result.error) {
        setSaveError(result.error)
      } else {
        setSavedCm(draft)
        setEditing(false)
      }
    })
  }

  function handleCancel() {
    setDraft(savedCm)
    setValidationErrors([])
    setSaveError(null)
    setInsertPos(null)
    setEditing(false)
  }

  // ── Render (edit mode) ─────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Content — editing
        </h3>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3">
          <p className="text-sm font-medium text-destructive">Fix before saving:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {validationErrors.map((e, i) => (
              <li key={i} className="text-sm text-destructive">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
      {saveError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Save failed: {saveError}
        </div>
      )}

      {/* Modules */}
      {draft.modules.map((mod, mi) => (
        <div key={mod.id} className="rounded-lg border bg-card">
          {/* Module header */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <input
              className="flex-1 rounded border bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
              value={mod.title}
              onChange={(e) => setModuleTitle(mi, e.target.value)}
              placeholder="Module title"
              aria-label={`Module ${mi + 1} title`}
            />
            <button
              type="button"
              onClick={() => moveModule(mi, 'up')}
              disabled={mi === 0}
              aria-label="Move module up"
              className="rounded p-1 hover:bg-muted disabled:opacity-30"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => moveModule(mi, 'down')}
              disabled={mi === draft.modules.length - 1}
              aria-label="Move module down"
              className="rounded p-1 hover:bg-muted disabled:opacity-30"
            >
              <ChevronDown className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => deleteModule(mi)}
              aria-label="Delete module"
              className="rounded p-1 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          {/* Blocks */}
          <div className="space-y-1 p-3">
            {/* Insert before first block */}
            <InsertSlot
              moduleIdx={mi}
              afterBlockIdx={-1}
              openPos={insertPos}
              insertType={insertType}
              onOpen={() => setInsertPos({ moduleIdx: mi, afterBlockIdx: -1 })}
              onTypeChange={setInsertType}
              onConfirm={commitInsert}
              onCancel={() => setInsertPos(null)}
            />

            {mod.blocks.map((blk, bi) => (
              <div key={blk.id} className="space-y-1">
                {/* Block card */}
                <div className="rounded-md border bg-background p-3 space-y-2">
                  {/* Block header */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {BLOCK_TYPE_LABELS[blk.type as BlockType] ?? blk.type}
                    </span>
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveBlock(mi, bi, 'up')}
                        disabled={bi === 0}
                        aria-label="Move block up"
                        className="rounded p-1 hover:bg-muted disabled:opacity-30"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(mi, bi, 'down')}
                        disabled={bi === mod.blocks.length - 1}
                        aria-label="Move block down"
                        className="rounded p-1 hover:bg-muted disabled:opacity-30"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteBlock(mi, bi)}
                        aria-label="Delete block"
                        className="rounded p-1 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Type-specific fields */}
                  <BlockFields
                    block={blk}
                    onChange={(updates) => updateBlock(mi, bi, updates)}
                  />
                </div>

                {/* Insert after this block */}
                <InsertSlot
                  moduleIdx={mi}
                  afterBlockIdx={bi}
                  openPos={insertPos}
                  insertType={insertType}
                  onOpen={() => setInsertPos({ moduleIdx: mi, afterBlockIdx: bi })}
                  onTypeChange={setInsertType}
                  onConfirm={commitInsert}
                  onCancel={() => setInsertPos(null)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
