import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requireActiveCompany } from '@/lib/context/server'
import { addAdmin, removeAdmin, respondToLink, revokeInvite } from './actions'

interface Props {
  searchParams: Promise<{ error?: string; notice?: string; invite_token?: string }>
}

interface AdminRow {
  membership_id: string | null
  invitation_id: string | null
  name: string | null
  email: string
  admin_type: 'in_house' | 'external' | 'third_party'
  nominated_by: string | null
  pending: boolean
}

interface LinkRow {
  link_id: string
  org_name: string
}

const TYPE_LABEL = { in_house: 'In-house', external: 'Company', third_party: 'Third party' } as const

export default async function CompanyAdminsPage({ searchParams }: Props) {
  const { supabase, company, isContractorAdmin } = await requireActiveCompany()
  if (!isContractorAdmin) redirect('/company/profile')
  const { error, notice, invite_token: token } = await searchParams

  const [{ data: rawAdmins }, { data: rawLinks }] = await Promise.all([
    supabase.rpc('list_company_admins', { p_company: company.id }),
    supabase.rpc('list_pending_company_links', { p_company: company.id }),
  ])
  const rows = (rawAdmins ?? []) as AdminRow[]
  const admins = rows.filter((r) => !r.pending)
  const invites = rows.filter((r) => r.pending)
  const links = (rawLinks ?? []) as LinkRow[]

  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Admins and link requests</h1>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {token && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <p className="mb-1.5 font-medium text-green-800">Invitation created — share this link (dev mode, no email sent):</p>
          <code className="block break-all font-mono text-xs text-green-900">{`${proto}://${host}/register/company?token=${token}`}</code>
        </div>
      )}

      {links.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Organizations asking to work with {company.name}</h2>
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.link_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                <span className="font-medium">{l.org_name}</span>
                <form action={respondToLink} className="flex gap-2">
                  <input type="hidden" name="link_id" value={l.link_id} />
                  <Button type="submit" name="accept" value="yes" size="sm">Accept</Button>
                  <Button type="submit" name="accept" value="no" size="sm" variant="outline">Decline</Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Admins</h2>
        <ul className="space-y-2">
          {admins.map((a) => (
            <li key={a.membership_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.name || a.email}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {a.email} · {TYPE_LABEL[a.admin_type]}
                  {a.nominated_by ? ` · nominated by ${a.nominated_by}` : ''}
                </p>
              </div>
              {admins.length > 1 && (
                <form action={removeAdmin}>
                  <input type="hidden" name="membership_id" value={a.membership_id ?? ''} />
                  <Button type="submit" size="sm" variant="outline">Remove</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {admins.length === 1 && <p className="text-xs text-muted-foreground">A company needs at least one admin: add another before removing this one.</p>}
      </section>

      {invites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Invited, not yet accepted</h2>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.invitation_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                <p className="min-w-0 truncate text-sm">
                  {i.email} · {TYPE_LABEL[i.admin_type]}
                  {i.nominated_by ? ` · from ${i.nominated_by}` : ''}
                </p>
                <form action={revokeInvite}>
                  <input type="hidden" name="invitation_id" value={i.invitation_id ?? ''} />
                  <Button type="submit" size="sm" variant="outline">Revoke</Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={addAdmin} className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Invite another admin</h2>
        <div className="space-y-2">
          <Label htmlFor="admin_email">Email</Label>
          <Input id="admin_email" name="admin_email" type="email" required />
        </div>
        <fieldset className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="admin_type" value="external" defaultChecked /> Someone at the company</label>
          <label className="flex items-center gap-2"><input type="radio" name="admin_type" value="third_party" /> A third party acting for the company</label>
        </fieldset>
        <Button type="submit">Send invitation</Button>
      </form>
    </div>
  )
}
