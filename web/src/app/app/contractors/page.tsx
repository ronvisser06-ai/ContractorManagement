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

interface WorkerSlice {
  company_id: string
  invited_email: string | null
  onboarding_status: string
}

const LINK_STATUS_STYLES: Record<string, string> = {
  invited: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
}

const ONBOARDING_STYLES: Record<string, string> = {
  entered: 'bg-blue-100 text-blue-800',
  invited: 'bg-yellow-100 text-yellow-800',
  logged_in: 'bg-indigo-100 text-indigo-800',
  account_created: 'bg-green-100 text-green-800',
}

function StatusBadge({ status }: { status: string }) {
  const cls = LINK_STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  )
}

function OnboardingBadge({ status }: { status: string }) {
  const cls = ONBOARDING_STYLES[status] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace('_', ' ')}
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

  // Client Admin sliced worker view: fetch workers for all active linked companies.
  // RLS "company_memberships: read if member or linked" permits linked client orgs.
  // We only get invited_email + onboarding_status — full user profiles are gated on
  // site activation (HowDesign-DataModel §4.2, deferred until M3).
  const activeCompanyIds = links.filter((l) => l.status === 'active').map((l) => l.company_id)
  const workersByCompany = new Map<string, WorkerSlice[]>()

  if (activeCompanyIds.length > 0) {
    const { data: rawWorkers } = await supabase
      .from('company_memberships')
      .select('company_id, invited_email, onboarding_status')
      .in('company_id', activeCompanyIds)
      .eq('status', 'active')
      .contains('roles', ['worker'])
      .order('created_at', { ascending: true })

    for (const w of (rawWorkers ?? []) as WorkerSlice[]) {
      const arr = workersByCompany.get(w.company_id) ?? []
      arr.push(w)
      workersByCompany.set(w.company_id, arr)
    }
  }

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
        <ul className="space-y-3">
          {links.length > 0 ? (
            links.map((link) => {
              const co = link.contractor_companies
              const token = tokenByCompany.get(link.company_id)
              const inviteUrl = token ? `${baseUrl}/register/company?token=${token}` : null
              const workers = workersByCompany.get(link.company_id) ?? []

              return (
                <li key={link.id} className="space-y-3 rounded-lg border bg-card px-4 py-3">
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

                  {/* Client Admin sliced worker view — only shown for active links */}
                  {isClientAdmin && link.status === 'active' && (
                    <div className="border-t pt-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Workers ({workers.length})
                      </p>
                      {workers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No workers enrolled yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {workers.map((w, i) => (
                            <li key={i} className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm text-muted-foreground">
                                {w.invited_email ?? '—'}
                              </span>
                              <OnboardingBadge status={w.onboarding_status} />
                            </li>
                          ))}
                        </ul>
                      )}
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
