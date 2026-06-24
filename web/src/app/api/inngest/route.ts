import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { helloWorld } from '@/lib/inngest/functions/hello'
import { runGenerationJob } from '@/lib/inngest/functions/run-generation-job'
import { publishOrientationPackage } from '@/lib/inngest/functions/publish-orientation-package'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [helloWorld, runGenerationJob, publishOrientationPackage],
})
