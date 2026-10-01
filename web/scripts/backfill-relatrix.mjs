// Sends Relatrix the client organizations that existed before the integration was switched on
// (Relatrix-Integration-Brief.md, slice S6). It only QUEUES; the drain (Inngest, every minute) does the sending, in whatever
// mode RELATRIX_SYNC_MODE is in, so `dry-run` is the preview of what a real run would send.
//
//   node --env-file=.env.local scripts/backfill-relatrix.mjs                    show the plan; writes nothing
//   node --env-file=.env.local scripts/backfill-relatrix.mjs --queue            queue what is new or changed
//   node --env-file=.env.local scripts/backfill-relatrix.mjs --status           how the queue stands, and what needs attention
//
//   --limit N        queue at most N organizations (a first small batch)
//   --only id,id     only these organizations
//   --skip id,id     never these (test organizations)
//   --yes            required with --queue while RELATRIX_SYNC_MODE=live: the drain will send them within a minute
//
// Safe to run twice and to stop halfway: it queues only what is new or has changed. Needs NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (the same ones the app uses); neither is printed.

import { createClient } from '@supabase/supabase-js'
import { applyPlan, buildPlan, describePlan, parseArgs } from '../src/lib/relatrix/backfill.ts'
import { databaseSource, queueStatus } from '../src/lib/relatrix/backfill-source.ts'
import { readConfig } from '../src/lib/relatrix/config.ts'
import { databaseStore } from '../src/lib/relatrix/store.ts'

const args = parseArgs(process.argv.slice(2))
if ('error' in args) {
  console.error(args.error)
  process.exit(2)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run with node --env-file=.env.local).')
  process.exit(2)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })
const config = readConfig(process.env)
const mode = config.ok ? config.config.mode : config.mode

try {
  if (args.command === 'status') {
    const { counts, problems } = await queueStatus(supabase)
    console.log(`Sync mode: ${mode}`)
    console.log(counts.length ? counts.map((c) => `  ${c.status.padEnd(10)} ${c.count}`).join('\n') : '  the queue is empty')
    for (const p of problems) console.log(`  ! ${p.entity_id} ${p.status}${p.last_status ? ` (${p.last_status})` : ''}: ${p.last_error ?? ''}`)
    process.exit(0)
  }

  const plan = await buildPlan(databaseSource(supabase), { only: args.only, skip: args.skip })
  console.log(`Sync mode: ${mode}`)
  for (const line of describePlan(plan)) console.log(line)

  if (args.command === 'plan') {
    console.log('\nNothing was written. Add --queue to queue these.')
    process.exit(0)
  }

  if (mode === 'live' && !args.yes) {
    console.error('\nRefusing: the sync is LIVE, so the drain would start sending these to Relatrix within a minute. Run it in dry-run first, then add --yes.')
    process.exit(1)
  }
  const result = await applyPlan(plan, databaseStore(supabase), args.limit)
  console.log(`\nQueued ${result.queued}; ${result.unchanged} were already queued as they stand.`)
  console.log(
    mode === 'off'
      ? 'The sync is off, so nothing will be sent. Set RELATRIX_SYNC_MODE=dry-run to see what it would send, then live.'
      : mode === 'dry-run'
        ? 'The sync is in dry-run: the drain will record what it would send, and send nothing. Read it with --status, then switch to live.'
        : 'The sync is live: the drain sends them, about 20 a minute. Watch with --status.',
  )
} catch (e) {
  // The message only: a Supabase error can name the table, never a key.
  console.error(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`)
  process.exit(1)
}
