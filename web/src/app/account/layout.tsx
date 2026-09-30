import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getMembershipContext } from '@/lib/context/server'
import { Button } from '@/components/ui/button'
import { logout } from '@/app/(auth)/login/actions'

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  // Back-links to every portal kind the user has (F0: works with any number
  // of memberships; the portals themselves open on the active org/company).
  const ctx = await getMembershipContext()
  if (!ctx) redirect('/login')
  const hasOrg = ctx.orgs.length > 0
  const hasCompany = ctx.companies.length > 0

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">My Account</span>
            {hasOrg && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/app">Admin portal</Link>
              </Button>
            )}
            {hasCompany && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/company">Contractor portal</Link>
              </Button>
            )}
          </div>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
