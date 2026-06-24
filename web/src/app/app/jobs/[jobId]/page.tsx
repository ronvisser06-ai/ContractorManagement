import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { JobTracker } from './job-tracker'

interface Props {
  params: Promise<{ jobId: string }>
}

export default async function JobPage({ params }: Props) {
  const { jobId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // RLS ("generation_jobs: read if org member") scopes this to the caller's org.
  const { data: job } = await supabase
    .from('generation_jobs')
    .select('id, status, current_stage, rework_count, max_rework, qa_flagged, artifacts, qa_history, error, updated_at')
    .eq('id', jobId)
    .maybeSingle()

  if (!job) notFound()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Generation job</h1>
      <JobTracker jobId={jobId} initialJob={job} />
    </div>
  )
}
