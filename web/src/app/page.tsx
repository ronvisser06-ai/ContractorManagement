import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { logout } from '@/app/(auth)/login/actions'
import { switchContext } from '@/lib/context/actions'
import { getMembershipContext } from '@/lib/context/server'
import { landingFor, ROLE_LABEL, type ContextKind } from '@/lib/context/resolve'

interface Props {
  searchParams: Promise<{ error?: string }>
}

interface ChoiceItem {
  kind: ContextKind
  id: string
  name: string
  roles: string[]
}

// Landing router (F0 Step 2): sends each signed-in user to their portal, or
// shows a chooser when they belong to more than one org/company.
export default async function Home({ searchParams }: Props) {
  const ctx = await getMembershipContext()
  if (!ctx) redirect('/login')

  const { error } = await searchParams
  const landing = landingFor(ctx)
  // Errors (e.g. from switchContext) always render here instead of bouncing on.
  if (landing !== 'chooser' && !error) redirect(landing)

  const sections: { title: string; items: ChoiceItem[] }[] = [
    {
      title: 'Organizations',
      items: ctx.orgs.map((o) => ({ kind: 'org' as const, id: o.id, name: o.name, roles: o.roles })),
    },
    {
      title: 'Contractor companies',
      items: ctx.companies.map((c) => ({
        kind: 'company' as const,
        id: c.id,
        name: c.name,
        roles: c.roles,
      })),
    },
  ].filter((s) => s.items.length > 0)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Where do you want to work?</h1>
          <p className="text-muted-foreground text-sm">
            You belong to more than one organization or company. You can switch any time.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {sections.length === 0 && (
          <p className="text-center text-sm">
            You&apos;re not a member of any organization or company yet.{' '}
            <Link href="/onboarding/create-org" className="underline underline-offset-4">
              Create an organization
            </Link>
          </p>
        )}

        {sections.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">{section.title}</h2>
            <ul className="divide-y rounded-md border">
              {section.items.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <form
                    action={switchContext}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <input type="hidden" name="kind" value={item.kind} />
                    <input type="hidden" name="id" value={item.id} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {item.roles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r).join(' · ')}
                      </p>
                    </div>
                    <Button type="submit" size="sm">
                      Open
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="flex items-center justify-between text-sm">
          <Link href="/account/profile" className="underline underline-offset-4">
            My profile
          </Link>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
