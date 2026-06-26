import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ContentModel, QAIssue, Quiz } from '@/contracts/types'
import { approveJob } from './actions'
import { ContentModelEditor } from './content-model-editor'
import { QuizEditor } from './quiz-editor'

interface Props {
  jobId: string
  contentModel: ContentModel
  quiz: Quiz
  qaFlagged: boolean
  qaIssues: QAIssue[]
  canApprove: boolean
  canEdit: boolean
}

export function ApprovalReview({
  jobId,
  contentModel,
  quiz,
  qaFlagged,
  qaIssues,
  canApprove,
  canEdit,
}: Props) {
  return (
    <div className="space-y-8 rounded-lg border bg-card p-4 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Awaiting approval</h2>
        <p className="text-sm text-muted-foreground">Review the draft below before approving for publish.</p>
      </div>

      {qaFlagged && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          QA flagged this draft — issues are highlighted below next to the content they reference.
        </div>
      )}

      <ContentModelEditor jobId={jobId} initialCm={contentModel} canEdit={canEdit} qaIssues={qaIssues} />

      <QuizEditor
        jobId={jobId}
        initialQuiz={quiz}
        contentModel={contentModel}
        qaIssues={qaIssues}
        canEdit={canEdit}
      />

      {canApprove ? (
        <form action={approveJob} className="space-y-3 rounded-md border bg-background p-4">
          <input type="hidden" name="job_id" value={jobId} />
          <div className="space-y-2">
            <Label htmlFor="requalification_policy">Requalification policy</Label>
            <select
              id="requalification_policy"
              name="requalification_policy"
              defaultValue="new_content_only"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="full">Full — everyone must requalify</option>
              <option value="new_content_only">New content only — only changed modules</option>
              <option value="none">None — cosmetic change, no requalification</option>
            </select>
          </div>
          <Button type="submit">Approve &amp; publish</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for a Content Approver to review and approve this draft.</p>
      )}
    </div>
  )
}
