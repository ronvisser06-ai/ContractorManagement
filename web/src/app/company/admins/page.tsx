import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requireActiveCompany } from '@/lib/context/server'
import { ADMIN_TYPES, ADMIN_TYPE_LABEL, type AdminType } from '@/lib/companies/labels'
import { requestBaseUrl } from '@/lib/http/base-url'
import { invitePath } from '@/lib/http/safe-next'
import { inviteAdmin, removeAdmin, revokeAdminInvite } from './actions'

interface Props {
  searchParams: Promise<{ error?: string; invited?: string; invite_token?: string; removed?: string; revoked?: string }>
}

interface AdminRow {
  id: string
  user_id: string
  admin_type: AdminType | null
  users: { given_name: string; family_name: string; primary_email: string } | null
}

interface PendingInvite {
  id: string
  email: string
  admin_type: AdminType | null
  expires_at: string
  token: string
  org_id: string | null
}

export default async function CompanyAdminsPage({ searchParams }: Props) {
  const { supabase, user, company, isContractorAdmin } = await requireActiveCompany()
  if (!isContractorAdmin) redirect('/company/profile')

  // Admins of this company — "users: company member reads" lets admins see names.
  const { data: rawAdmins } = await supabase
    .from('company_memberships')
    .select('id, user_id, admin_type, users(given_name, family_name, primary_email)')
    .eq('company_id', company.id)
    .eq('status', 'active')
    .contains('roles', ['contractor_admin'])
    .order('created_at', { ascending: true })
  const admins = (rawAdmins ?? []) as unknown as AdminRow[]
  const onlyOne = admins.length <= 1

  // Pending admin invitations (company-issued, or the creating org's nomination).
  const { data: rawInvites } = await supabase
    .from('invitations')
    .select('id, email, admin_type, expires_at, token, org_id')
    .eq('company_id', company.id)
    .eq('type', 'company')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  const invites = (rawInvites ?? []) as PendingInvite[]

  const base = await requestBaseUrl()
  const { error, invited, invite_token, removed, revoked } = await searchParams

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admins</h1>
        <p className="text-sm text-muted-foreground">
          People who manage {company.name}: its profile, workers, crews, clients and admins.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}
      {invited && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p>
            Invitation created for <strong>{invited}</strong>.{' '}
            {invite_token
              ? "The email couldn't be sent — share this link with them (it only works for their address):"
              : 'They have been emailed a link to accept.'}
          </p>
          {invite_token && <code className="mt-1.5 block break-all font-mono text-xs">{base + invitePath(invite_token)}</code>}
        </div>
      )}
      {removed && (
        <div className="rounded-md border px-4 py-3 text-sm">
          <strong>{removed}</strong> is no longer an admin of {company.name}.
        </div>
      )}
      {revoked && <div className="rounded-md border px-4 py-3 text-sm">Invitation revoked.</div>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Current admins ({admins.length})</h2>
        <ul className="divide-y rounded-md border">
          {admins.map((a) => {
            const name = a.users ? `${a.users.given_name} ${a.users.family_name}`.trim() : '—'
            const self = a.user_id === user.id
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {name}
                    {self && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.users?.primary_email}
                    {a.admin_type && <> · {ADMIN_TYPE_LABEL[a.admin_type]}</>}
                  </p>
                </div>
                <form action={removeAdmin}>
                  <input type="hidden" name="membership_id" value={a.id} />
                  <input type="hidden" name="user_id" value={a.user_id} />
                  <input type="hidden" name="name" value={name} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={onlyOne}
                    title={onlyOne ? 'A company must keep at least one admin' : undefined}
                  >
                    {self ? 'Step down' : 'Remove'}
                  </Button>
                </form>
              </li>
            )
          })}
        </ul>
        {onlyOne && (
          <p className="text-xs text-muted-foreground">A company must keep at least one admin — invite another before removing this one.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Invite an admin</h2>
        <form action={inviteAdmin} className="space-y-3 rounded-lg border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_type">Admin type</Label>
              <select id="admin_type" name="admin_type" defaultValue="company_staff" className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                {ADMIN_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" className="w-full sm:w-auto">
            Send invitation
          </Button>
        </form>
      </section>

      {invites.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Pending invitations ({invites.length})</h2>
          <ul className="divide-y rounded-md border">
            {invites.map((i) => (
              <li key={i.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.admin_type ? ADMIN_TYPE_LABEL[i.admin_type] : 'Admin'} · expires {new Date(i.expires_at).toLocaleDateString()}
                      {i.org_id && ' · nominated by a client'}
                    </p>
                  </div>
                  <form action={revokeAdminInvite}>
                    <input type="hidden" name="invitation_id" value={i.id} />
                    <Button type="submit" size="sm" variant="outline">
                      Revoke
                    </Button>
                  </form>
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Show invitation link</summary>
                  <code className="mt-1 block break-all font-mono">{base + invitePath(i.token)}</code>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
