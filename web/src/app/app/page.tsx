import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { logout } from '@/app/(auth)/login/actions'

export default async function AppPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // All queries go through the Supabase client (anon key + user JWT) so RLS is enforced.
  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase
      .from('users')
      .select('given_name, family_name, primary_email')
      .eq('id', user.id)
      .single(),
    supabase
      .from('org_memberships')
      .select('org_id, roles')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle(),
  ])

  // No active org membership → send to onboarding
  if (!membership) redirect('/onboarding/create-org')

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', membership.org_id)
    .single()

  const roleLabel = (membership.roles as string[])
    .map((r) =>
      r
        .split('_')
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' '),
    )
    .join(', ')

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Contractor Orientation
          </span>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome, {profile?.given_name} {profile?.family_name}
          </h1>
          <p className="text-muted-foreground text-sm">{profile?.primary_email}</p>
        </div>

        <div className="rounded-lg border bg-card px-5 py-4 space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Organization
            </p>
            <p className="mt-0.5 text-lg font-semibold">{org?.name}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your role
            </p>
            <span className="mt-0.5 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-medium text-primary">
              {roleLabel}
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
