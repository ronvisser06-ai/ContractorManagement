import { eventType, staticSchema } from 'inngest'

// Emitted by the create-job action; consumed by runGenerationJob.
export const generationJobStart = eventType('generation/job.start', {
  schema: staticSchema<{ jobId: string; siteId: string; orgId: string }>(),
})
