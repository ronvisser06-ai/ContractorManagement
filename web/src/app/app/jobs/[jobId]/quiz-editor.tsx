'use client'

// Bounded quiz editor (contracts §7).
// Allowed: edit stem/options/correct_answer/rationale; add/remove questions
//          and options; toggle shuffle; set pass_threshold/attempts_allowed.
// Excluded: changing source_refs, new question types beyond the three defined.
// coverage_map and question_count are recomputed from the question array on save.

import { useState, useTransition } from 'react'
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QuizView } from '@/components/renderer/QuizView'
import type { ContentModel, QAIssue, Quiz, QuizQuestion } from '@/contracts/types'
import { saveQuizEdits } from './actions'

// ── Helpers ────────────────────────────────────────────────────────────────────

function genQuestionId(): string {
  return `q_human_${Math.random().toString(36).slice(2, 10)}`
}

function genOptionId(): string {
  return `opt_${Math.random().toString(36).slice(2, 8)}`
}

function makeDefaultQuestion(contentModel: ContentModel): QuizQuestion {
  const firstModule = contentModel.modules[0]
  const firstObj = firstModule?.learning_objectives[0]
  return {
    id: genQuestionId(),
    module_id: firstModule?.id ?? 'mod_human',
    objective_id: firstObj?.id ?? 'obj_human',
    source_refs: [],
    type: 'single_choice',
    difficulty: 'recall',
    stem: 'New question?',
    options: [
      { id: 'opt_a', text: 'Option A' },
      { id: 'opt_b', text: 'Option B' },
    ],
    correct_option_ids: ['opt_a'],
    rationale: 'Explanation of the correct answer.',
  }
}

function buildCoverageMap(questions: QuizQuestion[]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const q of questions) {
    if (!q.objective_id) continue
    if (!map[q.objective_id]) map[q.objective_id] = []
    map[q.objective_id].push(q.id)
  }
  return map
}

function citedBlockSnippet(contentModel: ContentModel, blockId: string): string {
  for (const mod of contentModel.modules) {
    for (const blk of mod.blocks) {
      if (blk.id !== blockId) continue
      const t = blk.text ?? blk.hazard ?? blk.title
      if (typeof t === 'string') return `"${t.slice(0, 50)}"`
    }
  }
  return blockId
}

function validateQuizClient(quiz: Quiz): string[] {
  const errors: string[] = []
  const t = quiz.meta.pass_threshold
  if (typeof t !== 'number' || t <= 0 || t > 1) errors.push('Pass threshold must be 1%–100%')
  if (quiz.meta.attempts_allowed < 1) errors.push('Attempts allowed must be at least 1')
  if (quiz.questions.length === 0) errors.push('Quiz must have at least one question')
  quiz.questions.forEach((q, qi) => {
    const label = `Q${qi + 1}`
    if (!q.stem.trim()) errors.push(`${label}: stem is required`)
    if (q.options.length < 2) errors.push(`${label}: at least 2 options required`)
    if (q.correct_option_ids.length === 0) errors.push(`${label}: must have at least one correct answer`)
    const optIds = new Set(q.options.map((o) => o.id))
    for (const cid of q.correct_option_ids) {
      if (!optIds.has(cid)) errors.push(`${label}: correct answer "${cid}" is not a valid option`)
    }
  })
  return errors
}

// ── Shared input class strings ─────────────────────────────────────────────────

const INPUT = 'w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring'
const TEXTAREA = `${INPUT} resize-y`
const SMALL_SELECT = 'rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring'

// ── IssueBanner ────────────────────────────────────────────────────────────────

function IssueBanner({ issue }: { issue: QAIssue }) {
  const cls =
    issue.severity === 'blocker'
      ? 'border-destructive/50 bg-destructive/10 text-destructive'
      : issue.severity === 'major'
        ? 'border-amber-500/50 bg-amber-500/10 text-amber-800'
        : 'border-border bg-muted/50 text-muted-foreground'
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>
      <span className="font-medium capitalize">{issue.severity}:</span> {issue.description}
      {issue.suggested_fix && (
        <p className="mt-0.5 text-xs opacity-80">Fix: {issue.suggested_fix}</p>
      )}
    </div>
  )
}

// ── QuizEditor ─────────────────────────────────────────────────────────────────

interface Props {
  jobId: string
  initialQuiz: Quiz
  contentModel: ContentModel
  qaIssues: QAIssue[]
  canEdit: boolean
}

export function QuizEditor({ jobId, initialQuiz, contentModel, qaIssues, canEdit }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Quiz>(initialQuiz)
  const [savedQuiz, setSavedQuiz] = useState<Quiz>(initialQuiz)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const quizIssues = qaIssues.filter((i) => i.target_stage === 'generate_quiz')

  function issuesForQuestion(qId: string): QAIssue[] {
    return quizIssues.filter((i) => i.target_ref === qId)
  }

  // ── View mode ──────────────────────────────────────────────────────────────

  if (!editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Quiz</h3>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(savedQuiz)
                setEditing(true)
              }}
            >
              Edit quiz
            </Button>
          )}
        </div>
        {/* QA issues summary in view mode */}
        {quizIssues.length > 0 && (
          <div className="space-y-2">
            {quizIssues.map((issue) => (
              <IssueBanner key={issue.id} issue={issue} />
            ))}
          </div>
        )}
        <QuizView quiz={savedQuiz} contentModel={contentModel} />
      </div>
    )
  }

  // ── Edit helpers ───────────────────────────────────────────────────────────

  function setMeta<K extends keyof Quiz['meta']>(key: K, value: Quiz['meta'][K]) {
    setDraft((p) => ({ ...p, meta: { ...p.meta, [key]: value } }))
  }

  function moveQuestion(qi: number, dir: 'up' | 'down') {
    const qs = [...draft.questions]
    const to = dir === 'up' ? qi - 1 : qi + 1
    if (to < 0 || to >= qs.length) return
    ;[qs[qi], qs[to]] = [qs[to], qs[qi]]
    setDraft((p) => ({ ...p, questions: qs }))
  }

  function deleteQuestion(qi: number) {
    setDraft((p) => ({ ...p, questions: p.questions.filter((_, i) => i !== qi) }))
  }

  function updateQuestion(qi: number, updates: Partial<QuizQuestion>) {
    setDraft((p) => ({
      ...p,
      questions: p.questions.map((q, i) => (i !== qi ? q : { ...q, ...updates })),
    }))
  }

  function changeQuestionType(qi: number, type: QuizQuestion['type']) {
    setDraft((p) => ({
      ...p,
      questions: p.questions.map((q, i) => {
        if (i !== qi) return q
        if (type === 'true_false') {
          return {
            ...q,
            type,
            options: [
              { id: 'opt_true', text: 'True' },
              { id: 'opt_false', text: 'False' },
            ],
            correct_option_ids: ['opt_true'],
          }
        }
        if (type === 'single_choice') {
          return { ...q, type, correct_option_ids: q.correct_option_ids.slice(0, 1) }
        }
        return { ...q, type }
      }),
    }))
  }

  function addOption(qi: number) {
    const newId = genOptionId()
    setDraft((p) => ({
      ...p,
      questions: p.questions.map((q, i) =>
        i !== qi ? q : { ...q, options: [...q.options, { id: newId, text: '' }] },
      ),
    }))
  }

  function removeOption(qi: number, optId: string) {
    setDraft((p) => ({
      ...p,
      questions: p.questions.map((q, i) =>
        i !== qi
          ? q
          : {
              ...q,
              options: q.options.filter((o) => o.id !== optId),
              correct_option_ids: q.correct_option_ids.filter((id) => id !== optId),
            },
      ),
    }))
  }

  function updateOptionText(qi: number, optId: string, text: string) {
    setDraft((p) => ({
      ...p,
      questions: p.questions.map((q, i) =>
        i !== qi ? q : { ...q, options: q.options.map((o) => (o.id !== optId ? o : { ...o, text })) },
      ),
    }))
  }

  function setCorrect(qi: number, optId: string, multi: boolean) {
    setDraft((p) => ({
      ...p,
      questions: p.questions.map((q, i) => {
        if (i !== qi) return q
        if (multi) {
          const already = q.correct_option_ids.includes(optId)
          return {
            ...q,
            correct_option_ids: already
              ? q.correct_option_ids.filter((id) => id !== optId)
              : [...q.correct_option_ids, optId],
          }
        }
        return { ...q, correct_option_ids: [optId] }
      }),
    }))
  }

  // ── Validation + save ──────────────────────────────────────────────────────

  function handleSave() {
    const errors = validateQuizClient(draft)
    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }
    setValidationErrors([])
    setSaveError(null)
    const quizToSave: Quiz = {
      ...draft,
      meta: { ...draft.meta, question_count: draft.questions.length },
      coverage_map: buildCoverageMap(draft.questions),
    }
    startTransition(async () => {
      const result = await saveQuizEdits(jobId, quizToSave)
      if (result.error) {
        setSaveError(result.error)
      } else {
        setSavedQuiz(quizToSave)
        setEditing(false)
      }
    })
  }

  function handleCancel() {
    setDraft(savedQuiz)
    setValidationErrors([])
    setSaveError(null)
    setEditing(false)
  }

  // ── Render (edit mode) ─────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Quiz — editing
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

      {/* Meta settings */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <p className="text-sm font-semibold">Quiz settings</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Pass threshold (%)</label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              className={INPUT}
              value={Math.round(draft.meta.pass_threshold * 100)}
              onChange={(e) => setMeta('pass_threshold', Number(e.target.value) / 100)}
              aria-label="Pass threshold percentage"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Attempts allowed</label>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              className={INPUT}
              value={draft.meta.attempts_allowed}
              onChange={(e) => setMeta('attempts_allowed', Number(e.target.value))}
              aria-label="Attempts allowed"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.meta.shuffle_questions}
              onChange={(e) => setMeta('shuffle_questions', e.target.checked)}
            />
            Shuffle question order
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.meta.shuffle_options}
              onChange={(e) => setMeta('shuffle_options', e.target.checked)}
            />
            Shuffle option order
          </label>
        </div>
      </div>

      {/* Questions */}
      {draft.questions.map((q, qi) => {
        const qIssues = issuesForQuestion(q.id)
        const isMulti = q.type === 'multi_choice'
        const isTrueFalse = q.type === 'true_false'
        return (
          <div key={q.id} className="rounded-lg border bg-card">
            {/* Question header */}
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span className="text-xs font-semibold text-muted-foreground">Q{qi + 1}</span>
              <select
                className={SMALL_SELECT}
                value={q.type}
                onChange={(e) => changeQuestionType(qi, e.target.value as QuizQuestion['type'])}
                aria-label="Question type"
              >
                <option value="single_choice">Single choice</option>
                <option value="multi_choice">Multi choice</option>
                <option value="true_false">True / False</option>
              </select>
              <select
                className={SMALL_SELECT}
                value={q.difficulty}
                onChange={(e) =>
                  updateQuestion(qi, { difficulty: e.target.value as QuizQuestion['difficulty'] })
                }
                aria-label="Difficulty"
              >
                <option value="recall">Recall</option>
                <option value="application">Application</option>
              </select>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={() => moveQuestion(qi, 'up')}
                  disabled={qi === 0}
                  aria-label="Move question up"
                  className="rounded p-1 hover:bg-muted disabled:opacity-30"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveQuestion(qi, 'down')}
                  disabled={qi === draft.questions.length - 1}
                  aria-label="Move question down"
                  className="rounded p-1 hover:bg-muted disabled:opacity-30"
                >
                  <ChevronDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteQuestion(qi)}
                  aria-label="Delete question"
                  className="rounded p-1 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-3">
              {/* QA issues inline */}
              {qIssues.map((issue) => (
                <IssueBanner key={issue.id} issue={issue} />
              ))}

              {/* Stem */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Question stem</label>
                <textarea
                  className={TEXTAREA}
                  rows={2}
                  value={q.stem}
                  onChange={(e) => updateQuestion(qi, { stem: e.target.value })}
                  placeholder="Question text"
                />
              </div>

              {/* Options */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  {isMulti ? 'Options — select all that apply' : isTrueFalse ? 'Options' : 'Options — select one correct'}
                </label>
                {q.options.map((opt) => {
                  const isCorrect = q.correct_option_ids.includes(opt.id)
                  return (
                    <div key={opt.id} className="flex items-center gap-2">
                      <input
                        type={isMulti ? 'checkbox' : 'radio'}
                        name={`correct-${q.id}`}
                        checked={isCorrect}
                        onChange={() => setCorrect(qi, opt.id, isMulti)}
                        aria-label="Mark as correct"
                        className="shrink-0"
                      />
                      <input
                        className="flex-1 min-w-0 rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        value={opt.text}
                        onChange={(e) => updateOptionText(qi, opt.id, e.target.value)}
                        placeholder="Option text"
                        readOnly={isTrueFalse}
                        aria-label={`Option text for ${opt.id}`}
                      />
                      {!isTrueFalse && (
                        <button
                          type="button"
                          onClick={() => removeOption(qi, opt.id)}
                          disabled={q.options.length <= 2}
                          aria-label="Remove option"
                          className="shrink-0 rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-30"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
                {!isTrueFalse && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => addOption(qi)}
                  >
                    + Add option
                  </button>
                )}
              </div>

              {/* Rationale */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Rationale</label>
                <textarea
                  className={TEXTAREA}
                  rows={2}
                  value={q.rationale}
                  onChange={(e) => updateQuestion(qi, { rationale: e.target.value })}
                  placeholder="Explanation of the correct answer"
                />
              </div>

              {/* Source refs — read-only display (§7: source_ref changes are not in scope) */}
              {q.source_refs.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Cites:{' '}
                  {q.source_refs.map((ref, idx) => (
                    <span key={ref}>
                      {idx > 0 && ', '}
                      {citedBlockSnippet(contentModel, ref)}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>
        )
      })}

      {/* Add question */}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          setDraft((p) => ({ ...p, questions: [...p.questions, makeDefaultQuestion(contentModel)] }))
        }
      >
        + Add question
      </Button>
    </div>
  )
}
