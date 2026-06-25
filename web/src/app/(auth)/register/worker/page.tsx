import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { claimWorkerInvite, loginAndMerge } from './actions'

interface Props {
  searchParams: Promise<{
    token?: string
    error?: string
    suggest?: string
    bypass?: string
    merge_error?: string
  }>
}

export default async function RegisterWorkerPage({ searchParams }: Props) {
  const { token, error, suggest, bypass, merge_error: mergeError } = await searchParams

  if (!token) {
    return (
      <InvalidInvite message="No invite token provided. Please use the link from your invitation." />
    )
  }

  const admin = createAdminClient()

  // Validate the token server-side (full atomic check happens inside the RPC on submit).
  const { data: inv } = await admin
    .from('invitations')
    .select('status, expires_at, email, company_id')
    .eq('token', token)
    .eq('type', 'worker')
    .maybeSingle()

  if (!inv) {
    return <InvalidInvite message="This invite link is not valid. Please request a new invitation." />
  }
  if ((inv.status as string) === 'accepted') {
    return (
      <InvalidInvite
        message="This invite has already been used."
        action={
          <Link href="/login" className="underline underline-offset-4">
            Sign in to your account
          </Link>
        }
      />
    )
  }
  if ((inv.status as string) !== 'pending') {
    return <InvalidInvite message="This invitation has been revoked." />
  }
  if (new Date(inv.expires_at as string) < new Date()) {
    return (
      <InvalidInvite message="This invite link has expired. Please ask your company admin to send a new one." />
    )
  }

  const invEmail = inv.email as string
  const companyId = inv.company_id as string

  // ── Soft-match prompt: "Is this you?" ────────────────────────────────────────
  if (suggest) {
    const { data: existingUser } = await admin
      .from('users')
      .select('given_name, family_name, mobile')
      .eq('id', suggest)
      .maybeSingle()

    const displayName = existingUser
      ? `${existingUser.given_name as string} ${existingUser.family_name as string}`.trim()
      : '—'
    const displayMobile = (existingUser?.mobile as string | null) ?? null

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Is this you?</h1>
            <p className="text-sm text-muted-foreground">
              We found an existing account that might be yours.
            </p>
          </div>

          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="font-medium">{displayName}</p>
            {displayMobile && (
              <p className="text-sm text-muted-foreground">Mobile: {displayMobile}</p>
            )}
          </div>

          {mergeError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {mergeError}
            </div>
          )}

          <form action={loginAndMerge} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="existing_user_id" value={suggest} />
            <p className="text-sm font-medium">
              If this is your account, sign in with your existing password to link this
              company to your profile.
            </p>
            <div className="space-y-2">
              <Label htmlFor="merge-email">Your existing email</Label>
              <Input
                id="merge-email"
                name="email"
                type="email"
                placeholder="your-existing@email.com"
                required
                autoComplete="email"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-password">Password</Label>
              <Input
                id="merge-password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full">
              Sign in &amp; link my account
            </Button>
          </form>

          <div className="text-center">
            <Link
              href={`/register/worker?token=${encodeURIComponent(token)}&bypass=1`}
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              Not me — create a new account
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Registration form ─────────────────────────────────────────────────────────
  // Pre-fill name from the provisional user created in Step 4a.
  const { data: membership } = await admin
    .from('company_memberships')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('invited_email', invEmail)
    .eq('status', 'active')
    .maybeSingle()

  let prefillGiven = ''
  let prefillFamily = ''
  let isProvisionalStub = true

  if (membership?.user_id) {
    const { data: authUserData } = await admin.auth.admin.getUserById(
      membership.user_id as string,
    )
    prefillGiven =
      ((authUserData.user?.user_metadata as Record<string, unknown> | undefined)
        ?.given_name as string | undefined) ?? ''
    prefillFamily =
      ((authUserData.user?.user_metadata as Record<string, unknown> | undefined)
        ?.family_name as string | undefined) ?? ''
    // A provisional stub has never signed in; an existing-user link has a sign-in history.
    isProvisionalStub = !authUserData.user?.last_sign_in_at
  }

  // If this membership was linked to an existing registered user (the "already registered"
  // fast-path in addWorker), show a sign-in prompt instead of a password-setup form —
  // we must never overwrite an existing user's password without their intent.
  if (!isProvisionalStub) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Accept company invitation</h1>
          <p className="text-sm text-muted-foreground">
            You already have an account for{' '}
            <span className="font-medium">{invEmail}</span>. Sign in to accept this
            invitation.
          </p>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <Button asChild className="w-full">
            <Link
              href={`/login`}
            >
              Sign in
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            After signing in, return to this link to complete the invitation.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ve been invited to join the Contractor Orientation platform.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form action={claimWorkerInvite} className="space-y-5">
          <input type="hidden" name="token" value={token} />
          {bypass === '1' && <input type="hidden" name="bypass_soft_match" value="1" />}

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Your details</legend>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={invEmail}
                readOnly
                className="bg-muted/50 text-muted-foreground"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="given_name">First name</Label>
                <Input
                  id="given_name"
                  name="given_name"
                  placeholder="Jane"
                  defaultValue={prefillGiven}
                  required
                  autoComplete="given-name"
                  autoFocus={!prefillGiven}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="family_name">Last name</Label>
                <Input
                  id="family_name"
                  name="family_name"
                  placeholder="Smith"
                  defaultValue={prefillFamily}
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mobile">
                Mobile{' '}
                <span className="font-normal text-muted-foreground">(optional — used for dedup)</span>
              </Label>
              <Input
                id="mobile"
                name="mobile"
                type="tel"
                placeholder="+1 (555) 000-0000"
                autoComplete="tel"
              />
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Set a password</legend>
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
            Create account &amp; accept invite
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
