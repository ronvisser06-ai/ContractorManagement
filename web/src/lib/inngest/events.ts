import { eventType, staticSchema } from 'inngest'
import type { RequalificationPolicy } from '@/contracts/types'

// Emitted by the create-job action; consumed by runGenerationJob.
export const generationJobStart = eventType('generation/job.start', {
  schema: staticSchema<{ jobId: string; siteId: string; orgId: string }>(),
})

// Emitted by the approve action once the job row has already been moved to
// publishing by the approver's own (RLS-enforced) session; consumed by
// publishOrientationPackage.
export const generationJobApprove = eventType('generation/job.approve', {
  schema: staticSchema<{
    jobId: string
    siteId: string
    orgId: string
    approvedBy: string
    requalificationPolicy: RequalificationPolicy
  }>(),
})
