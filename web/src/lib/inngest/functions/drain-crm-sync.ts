import { cron } from 'inngest'
import { inngest } from '../client'
import { crmSyncRequested } from '../events'
import { createRelatrixClient } from '@/lib/relatrix/client'
import { readConfig } from '@/lib/relatrix/config'
import { handlers } from '@/lib/relatrix/ops'
import { databaseStore } from '@/lib/relatrix/store'
import { createAdminClient } from '@/lib/supabase/admin'
import { drain } from '@/lib/relatrix/sync'

// Sends what ConTrak has queued for Relatrix CRM (Relatrix-Integration-Brief.md, slice S1). Runs every minute and when
// something is queued. One at a time: two drains would only race for the same rows (the database lets them not, but
// there is nothing to gain). With RELATRIX_SYNC_MODE unset or `off` it claims nothing and sends nothing, so a deployment
// that has not been set up is harmless.
export const drainCrmSync = inngest.createFunction(
  { id: 'drain-crm-sync', concurrency: { limit: 1 }, triggers: [cron('* * * * *'), crmSyncRequested] },
  async ({ step }) => {
    const configured = readConfig(process.env)
    if (!configured.ok) return { skipped: true as const, mode: configured.mode, reason: configured.reason }
    const { config } = configured

    return await step.run('drain', () =>
      drain({
        store: databaseStore(createAdminClient()),
        handlers,
        mode: config.mode === 'live' ? 'live' : 'dry-run',
        client: config.mode === 'live' ? createRelatrixClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }) : null,
      }),
    )
  },
)
