import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createSite, assignCompany, removeAssignment } from './actions'
import { createJob } from '@/app/app/jobs/actions'

interface Props {
  searchParams: Promise<{ error?: string }>
}

interface SiteAssignment {
  id: string
  site_id: string
  company_id: string
  status: string
  contractor_companies: { legal_name: string } | null
}

interface LinkedCompany {
  company_id: string
  contractor_companies: { legal_name: string } | null
}

export default async function SitesPage({ searchParams }: Props) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) redirect('/onboarding/create-org')

  const roles = membership.roles as string[]
  const isClientAdmin = roles.includes('client_admin')
  // Matches the "generation_jobs: write if client_admin or content_developer" RLS policy.
  const canStartGeneration = roles.includes('client_admin') || roles.includes('content_developer')

  // RLS ("sites: read if org member") already scopes this to the caller's org;
  // the explicit eq() keeps the query correct if a user ever belongs to >1 org.
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, created_at')
    .eq('org_id', membership.org_id)
    .order('created_at', { ascending: false })

  const siteIds = (sites ?? []).map((s) => s.id)

  // For Client Admin: fetch assignments and linked companies in parallel.
  const [rawAssignments, rawLinks] = await Promise.all([
    isClientAdmin && siteIds.length > 0
      ? supabase
          .from('site_company_assignments')
          .select('id, site_id, company_id, status, contractor_companies(legal_name)')
          .in('site_id', siteIds)
          .eq('status', 'active')
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    isClientAdmin
      ? supabase
          .from('client_company_links')
          .select('company_id, contractor_companies(legal_name)')
          .eq('org_id', membership.org_id as string)
          .eq('status', 'active')
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ])

  const assignments = rawAssignments as unknown as SiteAssignment[]
  const linkedCompanies = rawLinks as unknown as LinkedCompany[]

  // Build per-site map of currently assigned companies.
  const assignedBySite = new Map<string, SiteAssignment[]>()
  for (const a of assignments) {
    const arr = assignedBySite.get(a.site_id) ?? []
    arr.push(a)
    assignedBySite.set(a.site_id, arr)
  }

  const { error } = await searchParams

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {isClientAdmin && (
        <form action={createSite} className="flex items-end gap-3 rounded-lg border bg-card p-4">
          <div className="flex-1 space-y-2">
            <Label htmlFor="name">Site name</Label>
            <Input id="name" name="name" placeholder="Main Plant" required autoFocus />
          </div>
          <Button type="submit">Add site</Button>
        </form>
      )}

      <ul className="space-y-3">
        {sites && sites.length > 0 ? (
          sites.map((site) => {
            const siteAssignments = assignedBySite.get(site.id) ?? []
            const assignedCompanyIds = new Set(siteAssignments.map((a) => a.company_id))
            const unassignedCompanies = linkedCompanies.filter(
              (lc) => !assignedCompanyIds.has(lc.company_id),
            )

            return (
              <li key={site.id} className="space-y-3 rounded-lg border bg-card px-4 py-3">
                {/* Site header row */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{site.name}</p>
                  {canStartGeneration && (
                    <form action={createJob} className="flex items-center gap-2">
                      <input type="hidden" name="site_id" value={site.id} />
                      <input
                        type="file"
                        name="deck"
                        accept=".pptx,.pdf"
                        required
                        className="text-sm text-muted-foreground file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs file:font-medium"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        Start generation
                      </Button>
                    </form>
                  )}
                </div>

                {/* Company assignment section — Client Admin only */}
                {isClientAdmin && (
                  <div className="border-t pt-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Assigned companies ({siteAssignments.length})
                    </p>

                    {siteAssignments.length > 0 ? (
                      <ul className="space-y-1">
                        {siteAssignments.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2">
                            <span className="text-sm">
                              {a.contractor_companies?.legal_name ?? a.company_id}
                            </span>
                            <form action={removeAssignment}>
                              <input type="hidden" name="assignment_id" value={a.id} />
                              <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive h-7 px-2 text-xs">
                                Remove
                              </Button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">No companies assigned yet.</p>
                    )}

                    {unassignedCompanies.length > 0 && (
                      <form action={assignCompany} className="flex items-end gap-2 pt-1">
                        <input type="hidden" name="site_id" value={site.id} />
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Assign a company</Label>
                          <select
                            name="company_id"
                            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            defaultValue=""
                          >
                            <option value="" disabled>
                              Select company…
                            </option>
                            {unassignedCompanies.map((lc) => (
                              <option key={lc.company_id} value={lc.company_id}>
                                {lc.contractor_companies?.legal_name ?? lc.company_id}
                              </option>
                            ))}
                          </select>
                        </div>
                        <Button type="submit" size="sm">
                          Assign
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            )
          })
        ) : (
          <p className="text-muted-foreground text-sm">No sites yet.</p>
        )}
      </ul>
    </div>
  )
}
