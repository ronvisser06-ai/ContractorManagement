'use server'

import { createHash } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { newId } from '@/db/utils'
import { inngest } from '@/lib/inngest/client'
import { generationJobStart } from '@/lib/inngest/events'
import type { SourceAsset } from '@/contracts/types'
import { redirect } from 'next/navigation'

const ARTIFACTS_BUCKET = 'pipeline-artifacts'
const MAX_DECK_BYTES = 25 * 1024 * 1024

// Trust the extension, not the browser-reported MIME (unreliable across OSes),
// to decide both validity and the content-type we hand to Storage.
const MIME_BY_EXTENSION: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
}

export async function createJob(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const siteId = formData.get('site_id') as string | null
  if (!siteId) redirect('/app/sites?error=Site+is+required')

  const deck = formData.get('deck')
  if (!(deck instanceof File) || deck.size === 0) {
    redirect('/app/sites?error=A+deck+file+(.pptx+or+.pdf)+is+required')
  }
  if (deck.size > MAX_DECK_BYTES) {
    redirect('/app/sites?error=Deck+exceeds+the+25MB+limit')
  }
  const extension = deck.name.toLowerCase().split('.').pop()
  const mime = extension ? MIME_BY_EXTENSION[extension] : undefined
  if (!mime) {
    redirect('/app/sites?error=Only+.pptx+or+.pdf+decks+are+supported')
  }

  // Org comes from the caller's own active membership — never trust a client-submitted org_id.
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) redirect('/onboarding/create-org')

  // Confirm the site actually belongs to the caller's org rather than trusting the form value.
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', siteId)
    .eq('org_id', membership.org_id)
    .maybeSingle()

  if (!site) redirect('/app/sites?error=Site+not+found')

  // Compute SHA256 before any I/O — needed to form the idempotency key for the
  // duplicate/retry check below.
  const bytes = Buffer.from(await deck.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const idemKey = `${siteId}:sha256:${sha256}`

  // Check for an existing job for this exact deck+site before uploading anything.
  // Handles two cases without ever hitting the unique constraint:
  //   failed | cancelled → retry path (contracts §1): reset to queued, re-send event
  //   any other state    → route the user to the existing job with a clear notice
  const { data: existing } = await supabase
    .from('generation_jobs')
    .select('id, status')
    .eq('idempotency_key', idemKey)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'failed' || existing.status === 'cancelled') {
      // Retry: reset to queued, preserve existing source_asset and artifacts,
      // re-fire the start event so Inngest re-enters from extracting.
      await supabase
        .from('generation_jobs')
        .update({ status: 'queued', current_stage: 'queued', error: null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      await inngest.send(
        generationJobStart.create({ jobId: existing.id, siteId, orgId: membership.org_id }),
      )
      redirect(`/app/jobs/${existing.id}`)
    }

    const notice: Record<string, string> = {
      queued: 'Job+for+this+deck+is+already+queued',
      extracting: 'Job+for+this+deck+is+already+running',
      structuring: 'Job+for+this+deck+is+already+running',
      generating_quiz: 'Job+for+this+deck+is+already+running',
      qa_evaluating: 'Job+for+this+deck+is+already+running',
      awaiting_approval: 'A+draft+for+this+deck+is+awaiting+approval',
      publishing: 'This+deck+is+being+published',
      published: 'This+deck+is+already+published',
    }
    redirect(
      `/app/jobs/${existing.id}?notice=${notice[existing.status] ?? 'Job+for+this+deck+already+exists'}`,
    )
  }

  // New job — upload the deck then insert.
  const jobId = newId('job_')
  const safeName = deck.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const storageKey = `sites/${siteId}/jobs/${jobId}/source/${safeName}`

  const admin = createAdminClient()
  const { error: uploadErr } = await admin.storage
    .from(ARTIFACTS_BUCKET)
    .upload(storageKey, bytes, { contentType: mime, upsert: false })
  if (uploadErr) {
    redirect(`/app/sites?error=${encodeURIComponent(`Deck upload failed: ${uploadErr.message}`)}`)
  }

  const sourceAsset: SourceAsset = {
    storage_key: storageKey,
    filename: deck.name,
    mime,
    sha256,
    uploaded_by: user.id,
    uploaded_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('generation_jobs').insert({
    id: jobId,
    org_id: membership.org_id,
    site_id: siteId,
    created_by: user.id,
    source_asset: sourceAsset,
    idempotency_key: idemKey,
  })

  if (error) {
    redirect(`/app/sites?error=${encodeURIComponent(error.message)}`)
  }

  await inngest.send(generationJobStart.create({ jobId, siteId, orgId: membership.org_id }))

  redirect(`/app/jobs/${jobId}`)
}
