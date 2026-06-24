import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createSite } from './actions'

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

  const isClientAdmin = (membership.roles as string[]).includes('client_admin')

  // RLS ("sites: read if org member") already scopes this to the caller's org;
  // the explicit eq() keeps the query correct if a user ever belongs to >1 org.
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, created_at')
    .eq('org_id', membership.org_id)
    .order('created_at', { ascending: false })

  const { error } = await searchParams

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Contractor Orientation
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href="/app">Back to dashboard</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {isClientAdmin && (
          <form
            action={createSite}
            className="flex items-end gap-3 rounded-lg border bg-card p-4"
          >
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
              <li key={site.id} className="rounded-lg border bg-card px-4 py-3">
                <p className="font-medium">{site.name}</p>
              </li>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">No sites yet.</p>
          )}
        </ul>
      </main>
    </div>
  )
}
