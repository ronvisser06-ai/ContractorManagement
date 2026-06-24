import { inngest } from '../client'

// Proves the Inngest workflow engine is wired up end to end (Feature 2, Step 1).
// The real durable state machine (contracts §1) replaces this in Step 2.
export const helloWorld = inngest.createFunction(
  { id: 'hello-world', triggers: [{ event: 'test/hello.world' }] },
  async ({ step }) => {
    const greeting = await step.run('greet', async () => 'Hello from the orientation pipeline skeleton!')
    return { message: greeting }
  },
)
