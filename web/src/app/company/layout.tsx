import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { logout } from '@/app/(auth)/login/actions'
import { switchContext } from '@/lib/context/actions'
import { ROLE_LABEL } from '@/lib/context/resolve'
import { requireActiveCompany } from '@/lib/context/server'

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  // Contractor portal: the user's active company (F0). No company → landing router.
  const { company, companies, orgs, isContractorAdmin } = await requireActiveCompany()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/company" className="text-sm font-medium text-muted-foreground">
              Contractor Portal
            </Link>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {company.name} · {isContractorAdmin ? 'Contractor Admin' : 'Worker'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <form action={switchContext} className="flex items-center gap-2">
                <input type="hidden" name="kind" value="company" />
                <label htmlFor="company-switch" className="sr-only">
                  Switch company
                </label>
                <select
                  id="company-switch"
                  name="id"
                  defaultValue={company.id}
                  className="h-8 max-w-48 rounded-md border bg-background px-2 text-sm"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.roles.map((r) => ROLE_LABEL[r]).join(', ')})
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Switch
                </Button>
              </form>
            )}
            {orgs.length > 0 && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/">All portals</Link>
              </Button>
            )}
            <form action={logout}>
              <Button type="submit" variant="outline" size="sm">
                Log out
              </Button>
            </form>
          </div>
        </div>

        <nav className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center gap-1">
          {isContractorAdmin && (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/company/profile">Company Profile</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/company/admins">Admins</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/company/workers">Workers</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/company/crew">Crew</Link>
              </Button>
            </>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/account/profile">My Profile</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
