import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createSite } from './actions'
import { createJob } from '@/app/app/jobs/actions'

interface Props {
  searchParams: Promise<{ error?: string }>
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

      <ul className="space-y-2">
        {sites && sites.length > 0 ? (
          sites.map((site) => (
            <li
              key={site.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
            >
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
            </li>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">No sites yet.</p>
        )}
      </ul>
    </div>
  )
}
