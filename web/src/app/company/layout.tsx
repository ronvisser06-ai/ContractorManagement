import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { logout } from '@/app/(auth)/login/actions'

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Contractor portal: requires an active company membership.
  const { data: membership } = await supabase
    .from('company_memberships')
    .select('company_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) redirect('/login')

  const { data: company } = await supabase
    .from('contractor_companies')
    .select('legal_name')
    .eq('id', membership.company_id)
    .maybeSingle()

  const isAdmin = (membership.roles as string[]).includes('contractor_admin')

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/company" className="text-sm font-medium text-muted-foreground">
              Contractor Portal
            </Link>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {company?.legal_name ?? '—'} · {isAdmin ? 'Contractor Admin' : 'Worker'}
            </span>
          </div>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>

        <nav className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center gap-1">
          {isAdmin && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/company/profile">Company Profile</Link>
            </Button>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground/60">
            Workers
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide">
              Soon
            </span>
          </span>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
