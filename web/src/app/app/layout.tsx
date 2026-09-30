import Link from 'next/link'
import { orgRoleEnum } from '@/db/schema'
import { Button } from '@/components/ui/button'
import { logout } from '@/app/(auth)/login/actions'
import { switchContext } from '@/lib/context/actions'
import { requireActiveOrg } from '@/lib/context/server'

type OrgRole = (typeof orgRoleEnum.enumValues)[number]

interface NavItem {
  label: string
  href: string
  roles: OrgRole[]
}

// Areas not built yet (M1+) — shown as inert placeholders so the nav reflects
// the full role-aware shape of the product, not just what's shipped today.
interface ComingSoonItem {
  label: string
  roles: OrgRole[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Sites', href: '/app/sites', roles: ['client_admin'] },
  { label: 'Contractors', href: '/app/contractors', roles: ['client_admin'] },
  { label: 'Team', href: '/app/team', roles: ['client_admin'] },
]

const COMING_SOON: ComingSoonItem[] = [
  { label: 'Orientations', roles: ['client_admin', 'content_developer', 'content_approver'] },
]

function formatRole(role: string): string {
  return role
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Client portal: the user's active org (F0). No org → landing router.
  const { org, orgs, companies } = await requireActiveOrg()
  const roles: OrgRole[] = org.roles

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.some((r) => roles.includes(r)))
  const visibleSoon = COMING_SOON.filter((item) => item.roles.some((r) => roles.includes(r)))

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/app" className="text-sm font-medium text-muted-foreground">
              Contractor Orientation
            </Link>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {org.name} · {roles.map(formatRole).join(', ')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {orgs.length > 1 && (
              <form action={switchContext} className="flex items-center gap-2">
                <input type="hidden" name="kind" value="org" />
                <label htmlFor="org-switch" className="sr-only">
                  Switch organization
                </label>
                <select
                  id="org-switch"
                  name="id"
                  defaultValue={org.id}
                  className="h-8 max-w-48 rounded-md border bg-background px-2 text-sm"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Switch
                </Button>
              </form>
            )}
            {companies.length > 0 && (
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
          {visibleNav.map((item) => (
            <Button key={item.href} asChild variant="ghost" size="sm">
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
          <Button asChild variant="ghost" size="sm">
            <Link href="/account/profile">Profile</Link>
          </Button>
          {visibleSoon.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground/60"
            >
              {item.label}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide">
                Soon
              </span>
            </span>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
