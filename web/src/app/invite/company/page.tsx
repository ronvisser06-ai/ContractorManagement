import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/server'
import { ADMIN_TYPE_LABEL, type AdminType } from '@/lib/companies/labels'
import { invitePath } from '@/lib/http/safe-next'
import { acceptInvite, createAccountAndAccept, switchAccount } from './actions'

interface Props {
  searchParams: Promise<{ token?: string; error?: string; confirm?: string }>
}

interface InvitationView {
  company_name: string
  org_name: string | null
  admin_type: AdminType | null
  email: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  expired: boolean
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-center text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  const cls =
    tone === 'error'
      ? 'border-destructive/50 bg-destructive/10 text-destructive'
      : 'border-blue-200 bg-blue-50 text-blue-900'
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>
}

// F1 Step 3 — /invite/company?token=… : a nominated company admin accepts.
// Works for a new user (create account), an existing user signed out (sign in
// and come back) and signed in (accept; email must match — F1-5).
export default async function CompanyInvitePage({ searchParams }: Props) {
  const { token = '', error, confirm } = await searchParams
  const supabase = await createClient()

  const { data: rows } = token
    ? await supabase.rpc('get_company_invitation', { p_token: token })
    : { data: null }
  const inv = ((rows ?? []) as InvitationView[])[0]

  if (!inv) {
    return (
      <Shell title="Invitation not found">
        <Notice tone="error">This invitation link is not valid. Check that you used the full link from the email.</Notice>
      </Shell>
    )
  }
  if (inv.status === 'accepted') {
    return (
      <Shell title="Invitation already accepted">
        <Notice tone="info">
          This invitation for <strong>{inv.company_name}</strong> has already been used.{' '}
          <Link href="/" className="underline underline-offset-4">
            Go to your portals
          </Link>
        </Notice>
      </Shell>
    )
  }
  if (inv.status !== 'pending' || inv.expired) {
    return (
      <Shell title="Invitation no longer valid">
        <Notice tone="error">
          This invitation for <strong>{inv.company_name}</strong> has {inv.expired ? 'expired' : 'been replaced or cancelled'}.
          Ask {inv.org_name ?? 'the company'} to send a new one.
        </Notice>
      </Shell>
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Signed-in user matches if the invited address is their primary or a verified email.
  let matches = false
  if (user) {
    const invited = inv.email.toLowerCase()
    matches = (user.email ?? '').toLowerCase() === invited
    if (!matches) {
      const { data: emails } = await supabase
        .from('user_emails')
        .select('email, verified_at')
        .eq('user_id', user.id)
      matches = (emails ?? []).some((e) => (e.email as string).toLowerCase() === invited && e.verified_at)
    }
  }

  const loginHref = `/login?next=${encodeURIComponent(invitePath(token))}`

  return (
    <Shell title={`Administrator of ${inv.company_name}`}>
      <div className="space-y-1 text-center text-sm text-muted-foreground">
        <p>
          {inv.org_name ? (
            <>
              <strong className="text-foreground">{inv.org_name}</strong> has nominated you as administrator of{' '}
            </>
          ) : (
            <>You&apos;ve been invited to become an administrator of </>
          )}
          <strong className="text-foreground">{inv.company_name}</strong>
          {inv.admin_type && <> ({ADMIN_TYPE_LABEL[inv.admin_type]})</>}.
        </p>
        <p>Sent to {inv.email}</p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {confirm && (
        <Notice tone="info">Check your email to confirm your account, then open this invitation link again to accept.</Notice>
      )}

      {user && matches && (
        <form action={acceptInvite}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" className="w-full">
            Accept and open {inv.company_name}
          </Button>
        </form>
      )}

      {user && !matches && (
        <div className="space-y-3">
          <Notice tone="error">
            You&apos;re signed in as <strong>{user.email}</strong>, but this invitation was sent to{' '}
            <strong>{inv.email}</strong>. Sign in with that address to accept it.
          </Notice>
          <form action={switchAccount}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" variant="outline" className="w-full">
              Sign out and use {inv.email}
            </Button>
          </form>
        </div>
      )}

      {!user && (
        <div className="space-y-6">
          <section className="space-y-2 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Already have an account?</h2>
            <p className="text-xs text-muted-foreground">
              Sign in as {inv.email}; you&apos;ll come straight back here to accept.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={loginHref}>Sign in</Link>
            </Button>
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">New here? Create your account</h2>
            <form action={createAccountAndAccept} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={inv.email} disabled readOnly />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="given_name">First name</Label>
                  <Input id="given_name" name="given_name" required autoComplete="given-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="family_name">Last name</Label>
                  <Input id="family_name" name="family_name" required autoComplete="family-name" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
              </div>
              <Button type="submit" className="w-full">
                Create account and accept
              </Button>
            </form>
          </section>
        </div>
      )}
    </Shell>
  )
}
