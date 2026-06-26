import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ContentModel, JobRecord, QAIssue, QAVerdict, Quiz } from '@/contracts/types'
import { JobTracker } from './job-tracker'
import { ApprovalReview } from './approval-review'

const ARTIFACTS_BUCKET = 'pipeline-artifacts'

// Artifacts are private (service-role only), so reading their JSON body for
// the review screen needs the admin client — the same reason Storage writes
// throughout this pipeline always go through it.
async function downloadArtifactPayload<T>(storageKey: string): Promise<T> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(ARTIFACTS_BUCKET).download(storageKey)
  if (error) throw new Error(`failed to download artifact ${storageKey}: ${error.message}`)
  const envelope = JSON.parse(await data.text()) as { payload: T }
  return envelope.payload
}

interface Props {
  params: Promise<{ jobId: string }>
  searchParams: Promise<{ error?: string }>
}

export default async function JobPage({ params, searchParams }: Props) {
  const { jobId } = await params
  const { error: errorParam } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // RLS ("generation_jobs: read if org member") scopes this to the caller's org.
  const { data: job } = await supabase
    .from('generation_jobs')
    .select(
      'id, org_id, status, current_stage, rework_count, max_rework, qa_flagged, artifacts, qa_history, error, updated_at',
    )
    .eq('id', jobId)
    .maybeSingle()

  if (!job) notFound()

  let review: {
    contentModel: ContentModel
    quiz: Quiz
    canApprove: boolean
    canEdit: boolean
    qaIssues: QAIssue[]
  } | null = null

  if (job.status === 'awaiting_approval') {
    const artifacts = job.artifacts as JobRecord['artifacts']
    const contentModelRef = artifacts.content_model
    const quizRef = artifacts.quiz

    if (contentModelRef && quizRef) {
      // Fetch QA verdict when flagged so we can surface issues next to their references.
      const qaVerdictRef = artifacts.qa_verdict
      const downloads: [Promise<ContentModel>, Promise<Quiz>, Promise<QAVerdict | null>] = [
        downloadArtifactPayload<ContentModel>(contentModelRef.storage_key),
        downloadArtifactPayload<Quiz>(quizRef.storage_key),
        job.qa_flagged && qaVerdictRef
          ? downloadArtifactPayload<QAVerdict>(qaVerdictRef.storage_key)
          : Promise.resolve(null),
      ]
      const [contentModel, quiz, qaVerdict] = await Promise.all(downloads)

      const { data: membership } = await supabase
        .from('org_memberships')
        .select('roles')
        .eq('user_id', user.id)
        .eq('org_id', job.org_id)
        .eq('status', 'active')
        .maybeSingle()

      const roles = (membership?.roles as string[] | undefined) ?? []
      const canApprove = roles.includes('content_approver')
      const canEdit = roles.some((r) =>
        ['content_developer', 'content_approver', 'client_admin'].includes(r),
      )
      review = {
        contentModel,
        quiz,
        canApprove,
        canEdit,
        qaIssues: qaVerdict?.issues ?? [],
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Generation job</h1>
      {errorParam && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorParam}
        </div>
      )}
      <JobTracker jobId={jobId} initialJob={job} />
      {review && (
        <ApprovalReview
          jobId={jobId}
          contentModel={review.contentModel}
          quiz={review.quiz}
          qaFlagged={job.qa_flagged}
          qaIssues={review.qaIssues}
          canApprove={review.canApprove}
          canEdit={review.canEdit}
        />
      )}
    </div>
  )
}
