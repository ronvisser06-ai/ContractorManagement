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

  // Fetch profile via the Supabase client (anon key + user JWT) so RLS is enforced.
  // A user can only read their own row — this doubles as a live RLS check.
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('given_name, family_name, primary_email')
    .eq('id', user.id)
    .single()

  // Verify RLS: query the full table — should return exactly 1 row (own row only)
  const { data: allRows } = await supabase
    .from('users')
    .select('id')

  const rlsOk = Array.isArray(allRows) && allRows.length === 1

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
          <p className="text-muted-foreground">{profile?.primary_email}</p>
        </div>

        {profileError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Profile error: {profileError.message}
          </div>
        )}

        <div className="rounded-md border bg-card px-4 py-3 text-sm">
          <p className="font-medium">RLS check</p>
          <p className="text-muted-foreground mt-1">
            Querying <code>SELECT * FROM users</code> as this user returns{' '}
            <strong>{allRows?.length ?? '?'} row(s)</strong>.{' '}
            {rlsOk ? (
              <span className="text-green-600">✓ Isolated to own row only.</span>
            ) : (
              <span className="text-destructive">
                ✗ Expected 1 row — check RLS policies.
              </span>
            )}
          </p>
        </div>
      </main>
    </div>
  )
}
