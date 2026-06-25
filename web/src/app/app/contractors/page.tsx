import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { inviteContractorCompany } from './actions'

interface Props {
  searchParams: Promise<{ error?: string; invite_token?: string }>
}

interface CompanyInfo {
  legal_name: string
  contact_email: string | null
}

interface CompanyLink {
  id: string
  status: string
  invited_at: string
  company_id: string
  contractor_companies: CompanyInfo | null
}

interface PendingInvite {
  token: string
  company_id: string
}

const STATUS_STYLES: Record<string, string> = {
  invited: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  )
}

export default async function ContractorsPage({ searchParams }: Props) {
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

  const isClientAdmin = (membership.roles as string[]).includes('client_admin')

  // Linked companies for this org, with contractor details embedded
  const { data: rawLinks } = await supabase
    .from('client_company_links')
    .select('id, status, invited_at, company_id, contractor_companies(legal_name, contact_email)')
    .eq('org_id', membership.org_id)
    .order('invited_at', { ascending: false })

  const links = (rawLinks ?? []) as unknown as CompanyLink[]

  // Pending invitations — keyed by company_id for O(1) lookup in the list
  const { data: rawInvites } = await supabase
    .from('invitations')
    .select('token, company_id')
    .eq('org_id', membership.org_id)
    .eq('type', 'company')
    .eq('status', 'pending')

  const tokenByCompany = new Map<string, string>(
    ((rawInvites ?? []) as PendingInvite[]).map((i) => [i.company_id, i.token]),
  )

  // Construct the base URL for dev-mode link display
  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  const { error, invite_token: newToken } = await searchParams
  const newInviteUrl = newToken ? `${baseUrl}/register/company?token=${newToken}` : null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Contractors</h1>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {newInviteUrl && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <p className="mb-1.5 font-medium text-green-800">
            Invite created — share this link with the company contact (dev mode, no email sent yet):
          </p>
          <code className="block break-all font-mono text-xs text-green-900">{newInviteUrl}</code>
        </div>
      )}

      {isClientAdmin && (
        <form
          action={inviteContractorCompany}
          className="space-y-4 rounded-lg border bg-card p-4"
        >
          <h2 className="text-sm font-medium">Invite a contractor company</h2>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="contact_email">Company contact email</Label>
              <Input
                id="contact_email"
                name="contact_email"
                type="email"
                placeholder="contact@company.com"
                required
                autoFocus
              />
            </div>
            <Button type="submit">Send invite</Button>
          </div>
        </form>
      )}

      <section className="space-y-2">
        {links.length > 0 && (
          <h2 className="text-sm font-medium text-muted-foreground">Linked companies</h2>
        )}
        <ul className="space-y-2">
          {links.length > 0 ? (
            links.map((link) => {
              const co = link.contractor_companies
              const token = tokenByCompany.get(link.company_id)
              const inviteUrl = token ? `${baseUrl}/register/company?token=${token}` : null
              return (
                <li key={link.id} className="space-y-2 rounded-lg border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{co?.legal_name ?? '—'}</p>
                      {co?.contact_email && (
                        <p className="text-sm text-muted-foreground">{co.contact_email}</p>
                      )}
                    </div>
                    <StatusBadge status={link.status} />
                  </div>

                  {inviteUrl && (
                    <div className="rounded border border-dashed bg-muted/40 px-3 py-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Dev-mode invite link
                      </p>
                      <code className="break-all font-mono text-xs">{inviteUrl}</code>
                    </div>
                  )}
                </li>
              )
            })
          ) : (
            <p className="text-sm text-muted-foreground">No contractors linked yet.</p>
          )}
        </ul>
      </section>
    </div>
  )
}
