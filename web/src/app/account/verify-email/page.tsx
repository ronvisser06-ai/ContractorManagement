import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { confirmEmailVerification } from './actions'

interface Props {
  searchParams: Promise<{ token?: string; rpc_error?: string }>
}

const ERROR_LABELS: Record<string, string> = {
  already_used: 'This link has already been used.',
  expired: 'This verification link has expired. Please request a new one from your profile.',
  email_taken: 'This email address is already verified to another account.',
  invalid_token: 'Invalid or expired verification link.',
  not_authenticated: 'Please sign in to verify your email.',
}

export default async function VerifyEmailPage({ searchParams }: Props) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { token, rpc_error } = await searchParams

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Verify email</h1>
        <p className="text-sm text-muted-foreground">
          No token provided. Use the link shown on your profile page.
        </p>
      </div>
    )
  }

  // Fetch the pending verification to display the email address.
  // RLS "email_verifications: read own" requires user_id = auth.uid().
  const { data: verification } = await supabase
    .from('email_verifications')
    .select('email, status, expires_at')
    .eq('token', token)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!verification) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Verify email</h1>
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          This verification link is invalid or does not belong to your account.
        </div>
      </div>
    )
  }

  const isExpired = new Date(verification.expires_at) < new Date()
  const isUsed = verification.status !== 'pending'
  const errorLabel = rpc_error ? (ERROR_LABELS[rpc_error] ?? rpc_error) : null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Verify email</h1>

      {errorLabel && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorLabel}
        </div>
      )}

      {isUsed ? (
        <p className="text-sm text-muted-foreground">
          This link has already been used.{' '}
          <a href="/account/profile" className="underline">
            Return to profile
          </a>
        </p>
      ) : isExpired ? (
        <p className="text-sm text-muted-foreground">
          This link has expired.{' '}
          <a href="/account/profile" className="underline">
            Request a new one
          </a>
        </p>
      ) : (
        <div className="space-y-4 rounded-lg border bg-card px-4 py-4">
          <p className="text-sm">
            Add <strong>{verification.email}</strong> to your account?
          </p>
          <form action={confirmEmailVerification}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Confirm</Button>
          </form>
        </div>
      )}
    </div>
  )
}
