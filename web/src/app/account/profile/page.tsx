import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestEmailVerification } from './actions'

interface Props {
  searchParams: Promise<{
    error?: string
    verify_token?: string
    verify_email?: string
    verified?: string
  }>
}

interface UserEmailRow {
  id: string
  email: string
  is_primary: boolean
  verified_at: string | null
}

export default async function ProfilePage({ searchParams }: Props) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, emailsResult] = await Promise.all([
    supabase
      .from('users')
      .select('given_name, family_name, primary_email')
      .eq('id', user.id)
      .single(),
    supabase
      .from('user_emails')
      .select('id, email, is_primary, verified_at')
      .eq('user_id', user.id)
      .order('added_at', { ascending: true }),
  ])

  const profile = profileResult.data
  const additionalEmails = (emailsResult.data ?? []) as UserEmailRow[]

  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  const { error, verify_token, verify_email, verified } = await searchParams
  const verifyUrl = verify_token
    ? `${baseUrl}/account/verify-email?token=${verify_token}`
    : null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My Profile</h1>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {verified && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Email verified and added to your account.
        </div>
      )}

      {/* Identity card */}
      <section className="space-y-2 rounded-lg border bg-card px-4 py-4">
        <p className="font-medium">
          {profile?.given_name} {profile?.family_name}
        </p>

        {/* Primary auth email */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{profile?.primary_email}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Primary
          </span>
        </div>

        {/* Additional verified emails */}
        {additionalEmails.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{e.email}</span>
            {e.is_primary && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Primary
              </span>
            )}
            {e.verified_at ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Verified
              </span>
            ) : (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                Unverified
              </span>
            )}
          </div>
        ))}
      </section>

      {/* Dev-mode verification link */}
      {verifyUrl && (
        <div className="rounded-md border border-dashed bg-muted/40 px-4 py-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Dev-mode — verify <strong>{verify_email}</strong> (no email sent yet — Step 7):
          </p>
          <a
            href={verifyUrl}
            className="break-all font-mono text-xs text-blue-700 underline"
          >
            {verifyUrl}
          </a>
        </div>
      )}

      {/* Add email */}
      <section className="space-y-3 rounded-lg border bg-card px-4 py-4">
        <h2 className="text-sm font-medium">Add another email address</h2>
        <form action={requestEmailVerification} className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="another@example.com"
              required
            />
          </div>
          <Button type="submit">Add email</Button>
        </form>
      </section>
    </div>
  )
}
