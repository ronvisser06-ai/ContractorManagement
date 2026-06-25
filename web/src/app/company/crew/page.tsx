import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { activateWorker, deactivateWorker } from './actions'

interface Props {
  searchParams: Promise<{ error?: string }>
}

interface AssignedSiteRow {
  id: string
  site_id: string
  sites: { id: string; name: string } | null
}

interface WorkerRow {
  id: string
  user_id: string
  onboarding_status: string
  users: { given_name: string; family_name: string } | null
}

interface ActivationRow {
  id: string
  site_id: string
  user_id: string
  status: string
}

const ONBOARDING_STYLES: Record<string, string> = {
  entered: 'bg-blue-100 text-blue-800',
  invited: 'bg-yellow-100 text-yellow-800',
  logged_in: 'bg-indigo-100 text-indigo-800',
  account_created: 'bg-green-100 text-green-800',
}

function OnboardingBadge({ status }: { status: string }) {
  const cls = ONBOARDING_STYLES[status] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export default async function CrewPage({ searchParams }: Props) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('company_memberships')
    .select('company_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) redirect('/login')
  if (!(membership.roles as string[]).includes('contractor_admin')) {
    redirect('/company/profile')
  }

  const companyId = membership.company_id as string

  // Fetch assigned sites, workers, and activations in parallel.
  const [rawAssignments, rawWorkers, rawActivations] = await Promise.all([
    supabase
      .from('site_company_assignments')
      .select('id, site_id, sites(id, name)')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .then((r) => (r.data ?? []) as unknown as AssignedSiteRow[]),
    supabase
      .from('company_memberships')
      .select('id, user_id, onboarding_status, users(given_name, family_name)')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .contains('roles', ['worker'])
      .then((r) => (r.data ?? []) as unknown as WorkerRow[]),
    supabase
      .from('site_worker_activations')
      .select('id, site_id, user_id, status')
      .eq('company_id', companyId)
      .then((r) => (r.data ?? []) as unknown as ActivationRow[]),
  ])

  // Build activation lookup: siteId → userId → ActivationRow
  const activationMap = new Map<string, Map<string, ActivationRow>>()
  for (const a of rawActivations) {
    let byUser = activationMap.get(a.site_id)
    if (!byUser) {
      byUser = new Map()
      activationMap.set(a.site_id, byUser)
    }
    byUser.set(a.user_id, a)
  }

  const { error } = await searchParams

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Crew Activations</h1>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {rawAssignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your company has not been assigned to any sites yet.
        </p>
      ) : (
        <div className="space-y-5">
          {rawAssignments.map((asgn) => {
            const siteName = asgn.sites?.name ?? asgn.site_id
            const siteActivations = activationMap.get(asgn.site_id) ?? new Map<string, ActivationRow>()

            return (
              <section key={asgn.site_id} className="rounded-lg border bg-card">
                <div className="border-b px-4 py-3">
                  <p className="font-medium">{siteName}</p>
                </div>

                {rawWorkers.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    No workers enrolled yet.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {rawWorkers.map((w) => {
                      const activation = siteActivations.get(w.user_id)
                      const isActive = activation?.status === 'active'
                      const fullName = w.users
                        ? `${w.users.given_name} ${w.users.family_name}`.trim()
                        : w.user_id

                      return (
                        <li
                          key={w.user_id}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{fullName}</span>
                            <OnboardingBadge status={w.onboarding_status} />
                          </div>

                          {isActive ? (
                            <form action={deactivateWorker}>
                              <input type="hidden" name="activation_id" value={activation!.id} />
                              <Button
                                type="submit"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                              >
                                Deactivate
                              </Button>
                            </form>
                          ) : (
                            <form action={activateWorker}>
                              <input type="hidden" name="site_id" value={asgn.site_id} />
                              <input type="hidden" name="worker_user_id" value={w.user_id} />
                              <Button type="submit" size="sm" className="h-7 px-2 text-xs">
                                Activate
                              </Button>
                            </form>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
