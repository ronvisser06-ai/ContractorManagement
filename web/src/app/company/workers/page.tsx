import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addWorker, inviteWorker } from './actions'

interface Props {
  searchParams: Promise<{
    error?: string
    added?: string
    invited_token?: string
  }>
}

// Supabase infers the embedded `users` join as an array even for to-one FKs.
interface WorkerUser {
  given_name: string
  family_name: string
  primary_email: string
  mobile: string | null
}

interface WorkerMembership {
  id: string
  onboarding_status: string
  invited_email: string | null
  users: WorkerUser | null
}

interface WorkerInvite {
  token: string
  email: string
}

const STATUS_STYLES: Record<string, string> = {
  entered: 'bg-blue-100 text-blue-800',
  invited: 'bg-yellow-100 text-yellow-800',
  logged_in: 'bg-indigo-100 text-indigo-800',
  account_created: 'bg-green-100 text-green-800',
}

function OnboardingBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'
  const label = status.replace('_', ' ')
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {label}
    </span>
  )
}

export default async function WorkersPage({ searchParams }: Props) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: myMembership } = await supabase
    .from('company_memberships')
    .select('company_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!myMembership) redirect('/login')

  const isAdmin = (myMembership.roles as string[]).includes('contractor_admin')
  const companyId = myMembership.company_id as string

  // Worker memberships for this company, with user profile joined.
  // The "users: company member reads" policy (migration 0009) enables the join.
  const { data: rawMembers } = await supabase
    .from('company_memberships')
    .select('id, onboarding_status, invited_email, users(given_name, family_name, primary_email, mobile)')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .contains('roles', ['worker'])
    .order('created_at', { ascending: true })

  const workers = (rawMembers ?? []) as unknown as WorkerMembership[]

  // Pending worker invitations — keyed by email for O(1) lookup.
  const { data: rawInvites } = await supabase
    .from('invitations')
    .select('token, email')
    .eq('company_id', companyId)
    .eq('type', 'worker')
    .eq('status', 'pending')

  const tokenByEmail = new Map<string, string>(
    ((rawInvites ?? []) as WorkerInvite[]).map((i) => [i.email, i.token]),
  )

  // Build the base URL for dev-mode link display.
  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  const { error, added, invited_token: newToken } = await searchParams
  const newInviteUrl = newToken ? `${baseUrl}/register/worker?token=${newToken}` : null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {added && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Worker added to roster. Send them an invite to create their account.
        </div>
      )}

      {newInviteUrl && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <p className="mb-1.5 font-medium text-green-800">
            Invite created — share this link with the worker (dev mode, no email sent yet):
          </p>
          <code className="block break-all font-mono text-xs text-green-900">{newInviteUrl}</code>
        </div>
      )}

      {isAdmin && (
        <form action={addWorker} className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Add a worker</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="given_name">First name</Label>
              <Input id="given_name" name="given_name" placeholder="Jane" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="family_name">Last name</Label>
              <Input id="family_name" name="family_name" placeholder="Smith" required />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="jane@example.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mobile">
                Mobile{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="mobile" name="mobile" type="tel" placeholder="+1 (555) 000-0000" />
            </div>
          </div>
          <Button type="submit">Add worker</Button>
        </form>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {workers.length === 0 ? 'No workers yet.' : `${workers.length} worker${workers.length === 1 ? '' : 's'}`}
        </h2>

        <ul className="space-y-2">
          {workers.map((w) => {
            const u = w.users
            const displayName = u ? `${u.given_name} ${u.family_name}`.trim() : '—'
            const displayEmail = u?.primary_email ?? w.invited_email ?? '—'
            const token = w.invited_email ? tokenByEmail.get(w.invited_email) : undefined
            const inviteUrl = token ? `${baseUrl}/register/worker?token=${token}` : null

            return (
              <li key={w.id} className="space-y-3 rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-medium">{displayName}</p>
                    <p className="text-sm text-muted-foreground">{displayEmail}</p>
                    {u?.mobile && (
                      <p className="text-sm text-muted-foreground">{u.mobile}</p>
                    )}
                  </div>
                  <OnboardingBadge status={w.onboarding_status} />
                </div>

                {/* Dev-mode invite link shown for already-invited workers */}
                {inviteUrl && (
                  <div className="rounded border border-dashed bg-muted/40 px-3 py-2">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Dev-mode invite link
                    </p>
                    <code className="break-all font-mono text-xs">{inviteUrl}</code>
                  </div>
                )}

                {/* Send invite button for workers in 'entered' state */}
                {isAdmin && w.onboarding_status === 'entered' && (
                  <form action={inviteWorker}>
                    <input type="hidden" name="membership_id" value={w.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Send invite
                    </Button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
