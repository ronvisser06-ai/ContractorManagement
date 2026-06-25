import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerFromCompanyInvite } from './actions'

interface Props {
  searchParams: Promise<{
    token?: string
    error?: string
    registered?: string
  }>
}

export default async function RegisterCompanyPage({ searchParams }: Props) {
  const { token, error, registered } = await searchParams

  // Success state — email confirmation pending
  if (registered) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Registration complete</h1>
          <p className="text-sm text-muted-foreground">
            Check your email to confirm your account, then{' '}
            <Link href="/login" className="underline underline-offset-4">
              sign in
            </Link>{' '}
            to access your company portal.
          </p>
        </div>
      </div>
    )
  }

  // Validate the token server-side before rendering the form
  if (!token) {
    return <InvalidInvite message="No invite token provided. Please use the link from your invitation email." />
  }

  const admin = createAdminClient()
  const { data: inv } = await admin
    .from('invitations')
    .select('status, expires_at, email, company_id')
    .eq('token', token)
    .eq('type', 'company')
    .maybeSingle()

  if (!inv) {
    return <InvalidInvite message="This invite link is not valid. Please request a new invitation." />
  }
  if (inv.status === 'accepted') {
    return (
      <InvalidInvite
        message="This invite has already been used."
        action={<Link href="/login" className="underline underline-offset-4">Sign in to your company portal</Link>}
      />
    )
  }
  if (inv.status !== 'pending') {
    return <InvalidInvite message="This invitation has been revoked." />
  }
  if (new Date(inv.expires_at as string) < new Date()) {
    return <InvalidInvite message="This invite link has expired. Please ask your client to send a new one." />
  }

  const prefillEmail = (inv.email as string | null) ?? ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Register your company</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ve been invited to join the Contractor Orientation platform.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form action={registerFromCompanyInvite} className="space-y-5">
          <input type="hidden" name="token" value={token} />

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Company details</legend>
            <div className="space-y-2">
              <Label htmlFor="legal_name">Company legal name</Label>
              <Input
                id="legal_name"
                name="legal_name"
                placeholder="Acme Contracting Ltd."
                required
                autoFocus
              />
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Your account</legend>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="given_name">First name</Label>
                <Input
                  id="given_name"
                  name="given_name"
                  placeholder="Jane"
                  required
                  autoComplete="given-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="family_name">Last name</Label>
                <Input
                  id="family_name"
                  name="family_name"
                  placeholder="Smith"
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={prefillEmail}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          </fieldset>

          <Button type="submit" className="w-full">
            Register &amp; accept invite
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

function InvalidInvite({
  message,
  action,
}: {
  message: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Invite not valid</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {action && <p className="text-sm">{action}</p>}
      </div>
    </div>
  )
}
