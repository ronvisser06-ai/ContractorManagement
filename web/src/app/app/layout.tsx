import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { orgRoleEnum } from '@/db/schema'
import { Button } from '@/components/ui/button'
import { logout } from '@/app/(auth)/login/actions'

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

  const roles = membership.roles as OrgRole[]

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', membership.org_id)
    .single()

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
              {org?.name} · {roles.map(formatRole).join(', ')}
            </span>
          </div>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>

        <nav className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center gap-1">
          {visibleNav.map((item) => (
            <Button key={item.href} asChild variant="ghost" size="sm">
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
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
