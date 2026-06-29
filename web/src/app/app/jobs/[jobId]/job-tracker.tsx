'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { JobRecord } from '@/contracts/types'
import { retryJob } from './actions'

export type JobRow = Pick<
  JobRecord,
  | 'id'
  | 'status'
  | 'current_stage'
  | 'rework_count'
  | 'max_rework'
  | 'qa_flagged'
  | 'artifacts'
  | 'qa_history'
  | 'error'
  | 'updated_at'
>

const STAGE_ORDER: JobRecord['status'][] = [
  'queued',
  'extracting',
  'structuring',
  'generating_quiz',
  'qa_review',
  'awaiting_approval',
  'publishing',
  'published',
]

const STAGE_LABELS: Record<JobRecord['status'], string> = {
  queued: 'Queued',
  extracting: 'Extracting',
  structuring: 'Structuring',
  generating_quiz: 'Generating quiz',
  qa_review: 'QA review',
  awaiting_approval: 'Awaiting approval',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

interface Props {
  jobId: string
  initialJob: JobRow
}

export function JobTracker({ jobId, initialJob }: Props) {
  const [job, setJob] = useState<JobRow>(initialJob)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`generation_jobs:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generation_jobs', filter: `id=eq.${jobId}` },
        (payload) => setJob(payload.new as JobRow),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [jobId])

  const currentIndex = STAGE_ORDER.indexOf(job.status)
  // published is terminal-success: every step in the list is done, none active.
  const isComplete = job.status === 'published'
  const artifactEntries = Object.entries(job.artifacts ?? {})

  return (
    <div className="space-y-6">
      <ol className="space-y-2">
        {STAGE_ORDER.map((stage, index) => {
          const state =
            currentIndex < 0
              ? 'pending'
              : isComplete || index < currentIndex
                ? 'done'
                : index === currentIndex
                  ? 'active'
                  : 'pending'

          return (
            <li
              key={stage}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                state === 'active' ? 'border-primary bg-primary/5' : 'border-border bg-card'
              }`}
            >
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  state === 'active'
                    ? 'bg-primary text-primary-foreground'
                    : state === 'done'
                      ? 'bg-foreground/80 text-background'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span className={state === 'pending' ? 'text-muted-foreground' : 'font-medium'}>
                {STAGE_LABELS[stage]}
              </span>
              {state === 'active' && <span className="ml-auto text-xs text-muted-foreground">In progress…</span>}
            </li>
          )
        })}
      </ol>

      {currentIndex < 0 && (
        <p className="text-sm text-muted-foreground">Status: {STAGE_LABELS[job.status] ?? job.status}</p>
      )}
      {(job.status === 'failed' || job.status === 'cancelled') && (
        <form action={retryJob}>
          <input type="hidden" name="job_id" value={jobId} />
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry generation
          </button>
        </form>
      )}

      {job.qa_flagged && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          QA flagged this draft for review.
        </div>
      )}

      {job.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {job.error.stage}: {job.error.message}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Artifacts</h2>
        {artifactEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {artifactEntries.map(([key, ref]) => (
              <li key={key} className="rounded-md border bg-card px-3 py-2">
                <span className="font-medium">{key}</span>{' '}
                <span className="text-muted-foreground">— {ref?.storage_key}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {job.qa_history.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">QA history</h2>
          <ul className="space-y-1 text-sm">
            {job.qa_history.map((entry, i) => (
              <li key={i} className="rounded-md border bg-card px-3 py-2">
                Attempt {entry.attempt}: <span className="font-medium">{entry.verdict}</span>
                {entry.open_issue_count > 0 && ` (${entry.open_issue_count} open issues)`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
