import { createHash } from 'node:crypto'
import { inngest } from '../client'
import { generationJobApprove } from '../events'
import { createAdminClient } from '@/lib/supabase/admin'
import { newId } from '@/db/utils'
import type { ArtifactRef, JobRecord } from '@/contracts/types'

// Drives awaiting_approval -> publishing -> published (contracts §1). The
// approve action has already moved the job to publishing and recorded
// approved_by/approved_at via the approver's own session (RLS-enforced);
// this function does the part that needs elevated access — freezing the
// draft into an immutable, versioned orientation_packages row.
export const publishOrientationPackage = inngest.createFunction(
  { id: 'publish-orientation-package', triggers: [generationJobApprove] },
  async ({ event, step }) => {
    const { jobId, siteId, orgId, requalificationPolicy } = event.data
    const supabase = createAdminClient()

    await step.run('enter-publishing', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({ status: 'publishing', current_stage: 'publishing', updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    })

    const result = await step.run('produce-published', async () => {
      const { data: job, error: jobErr } = await supabase
        .from('generation_jobs')
        .select('artifacts, qa_flagged, approved_by, approved_at')
        .eq('id', jobId)
        .single()
      if (jobErr) throw jobErr

      const artifacts = job.artifacts as JobRecord['artifacts']
      const contentModelRef = artifacts.content_model
      const quizRef = artifacts.quiz
      if (!contentModelRef || !quizRef) {
        throw new Error(`job ${jobId} is missing content_model or quiz artifacts`)
      }

      // Next version for this site, and what it supersedes (contracts §4.6).
      const { data: previous, error: prevErr } = await supabase
        .from('orientation_packages')
        .select('id, version')
        .eq('site_id', siteId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (prevErr) throw prevErr

      const version = (previous?.version ?? 0) + 1
      const contentHash = `sha256:${createHash('sha256')
        .update(`${contentModelRef.sha256}:${quizRef.sha256}`)
        .digest('hex')}`

      const packageId = newId('pkg_')
      const publishedAt = new Date().toISOString()

      const { error: insertErr } = await supabase.from('orientation_packages').insert({
        id: packageId,
        org_id: orgId,
        site_id: siteId,
        version,
        supersedes_id: previous?.id ?? null,
        content_model_ref: contentModelRef satisfies ArtifactRef,
        quiz_ref: quizRef satisfies ArtifactRef,
        asset_manifest: [], // empty until structuring is real (M2) and references real assets
        content_hash: contentHash,
        requalification_policy: requalificationPolicy,
        qa_flagged: job.qa_flagged,
        status: 'published',
        approved_by: job.approved_by,
        approved_at: job.approved_at,
        published_at: publishedAt,
      })
      if (insertErr) throw insertErr

      return { packageId, version }
    })

    await step.run('enter-published', async () => {
      const { error } = await supabase
        .from('generation_jobs')
        .update({
          status: 'published',
          current_stage: 'published',
          package_id: result.packageId,
          package_version: result.version,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
      if (error) throw error
    })

    await step.run('update-site-active-package', async () => {
      const { error } = await supabase.from('sites').update({ active_package_id: result.packageId }).eq('id', siteId)
      if (error) throw error
    })

    return { packageId: result.packageId, version: result.version }
  },
)
