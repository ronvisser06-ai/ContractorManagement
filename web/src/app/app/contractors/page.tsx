import { headers } from 'next/headers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { inviteContractorCompany } from './actions'
import { requireActiveOrg } from '@/lib/context/server'
import { filterOptions, heldByCompany, holding } from '@/lib/companies/capabilities'

interface Props {
  searchParams: Promise<{ error?: string; invite_token?: string; invited?: string; defined?: string; linked?: string; cap?: string }>
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
  user_id: string
  invited_email: string | null
  onboarding_status: string
}

interface WorkerCompanySummary {
  total_company_count: number
  shared_companies: string[]
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
  const { supabase, org, hasRole } = await requireActiveOrg()
  const isClientAdmin = hasRole('client_admin')

  // Linked companies for this org, with contractor details embedded
  const { data: rawLinks } = await supabase
    .from('client_company_links')
    .select('id, status, invited_at, company_id, contractor_companies(legal_name, contact_email)')
    .eq('org_id', org.id)
    .order('invited_at', { ascending: false })

  const allLinks = (rawLinks ?? []) as unknown as CompanyLink[]

  // What each linked company does. RLS lets an organization read this only for companies it is actively linked to.
  const { data: rawCaps } = allLinks.length
    ? await supabase.from('company_capabilities').select('company_id, custom_label, capabilities(code, label)').in('company_id', allLinks.map((l) => l.company_id))
    : { data: [] }
  const held = heldByCompany((rawCaps ?? []) as unknown as Parameters<typeof heldByCompany>[0])
  const options = filterOptions(held)

  // Pending invitations — keyed by company_id for O(1) lookup in the list
  const { data: rawInvites } = await supabase
    .from('invitations')
    .select('token, company_id')
    .eq('org_id', org.id)
    .eq('type', 'company')
    .eq('status', 'pending')

  const tokenByCompany = new Map<string, string>(
    ((rawInvites ?? []) as PendingInvite[]).map((i) => [i.company_id, i.token]),
  )

  // Client Admin sliced worker view: fetch workers for all active linked companies.
  // RLS "company_memberships: read if member or linked" permits linked client orgs.
  // user_id is fetched so we can call worker_company_summary for registered workers.
  const activeCompanyIds = allLinks.filter((l) => l.status === 'active').map((l) => l.company_id)
  const workersByCompany = new Map<string, WorkerSlice[]>()
  const summaryByUser = new Map<string, WorkerCompanySummary>()

  if (activeCompanyIds.length > 0) {
    const { data: rawWorkers } = await supabase
      .from('company_memberships')
      .select('company_id, user_id, invited_email, onboarding_status')
      .in('company_id', activeCompanyIds)
      .eq('status', 'active')
      .contains('roles', ['worker'])
      .order('created_at', { ascending: true })

    const workers = (rawWorkers ?? []) as WorkerSlice[]
    for (const w of workers) {
      const arr = workersByCompany.get(w.company_id) ?? []
      arr.push(w)
      workersByCompany.set(w.company_id, arr)
    }

    // §4.4 cross-company summary: fetch for workers who have completed registration.
    // The SECURITY DEFINER RPC computes total_company_count across ALL memberships
    // (bypassing RLS) and returns names only for companies the viewer's org also links.
    const registeredUserIds = [
      ...new Set(
        workers
          .filter((w) => w.onboarding_status === 'account_created')
          .map((w) => w.user_id),
      ),
    ]

    await Promise.all(
      registeredUserIds.map(async (userId) => {
        const { data } = await supabase.rpc('worker_company_summary', { p_worker_id: userId })
        if (data) summaryByUser.set(userId, data as WorkerCompanySummary)
      }),
    )
  }

  const isDevMode = !process.env.RESEND_API_KEY

  // Construct the base URL for dev-mode link display
  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  const { error, invite_token: newToken, invited, defined, linked, cap } = await searchParams
  const chosen = options.find((o) => o.code === cap) ?? null
  const links = holding(allLinks, held, chosen?.code ?? null)
  const newInviteUrl = newToken ? `${baseUrl}/register/company?token=${newToken}` : null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Contractors</h1>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {invited && !newInviteUrl && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Invite sent — the company contact will receive an email with a registration link.
        </div>
      )}

      {defined && !newInviteUrl && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">Company added.</div>
      )}

      {linked && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Link requested. The company’s administrator {linked === 'told' ? 'has been emailed and' : 'will'} need to accept before it shows as active.
        </div>
      )}

      {newInviteUrl && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <p className="mb-1.5 font-medium text-green-800">
            Invite created — share this link with the company contact (dev mode, no email sent):
          </p>
          <code className="block break-all font-mono text-xs text-green-900">{newInviteUrl}</code>
        </div>
      )}

      {isClientAdmin && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div>
            <h2 className="text-sm font-medium">Add a contractor company</h2>
            <p className="text-xs text-muted-foreground">Enter its details, link it if it is already on the platform, and name its administrator.</p>
          </div>
          <Link href="/app/contractors/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Add company</Link>
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
        {allLinks.length > 0 && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Linked companies{chosen ? ` that do ${chosen.label}` : ''}</h2>
            {options.length > 0 && (
              <form method="get" className="flex items-center gap-2">
                <label htmlFor="cap" className="sr-only">Filter by capability</label>
                <select id="cap" name="cap" defaultValue={chosen?.code ?? ''} className="h-8 max-w-56 rounded-md border bg-background px-2 text-sm">
                  <option value="">All capabilities</option>
                  {options.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label} ({o.count})
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">Filter</Button>
                {chosen && (
                  <Link href="/app/contractors" className="text-xs text-muted-foreground underline">Clear</Link>
                )}
              </form>
            )}
          </div>
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

                  {(held.get(link.company_id) ?? []).length > 0 && (
                    <ul className="flex flex-wrap gap-1.5" aria-label="What this company does">
                      {(held.get(link.company_id) ?? []).map((h) => (
                        <li key={`${h.code ?? 'x'}:${h.label}`} className={`rounded-full border px-2 py-0.5 text-xs ${h.code !== null && h.code === chosen?.code ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'}`}>
                          {h.label}
                        </li>
                      ))}
                    </ul>
                  )}

                  {inviteUrl && isDevMode && (
                    <div className="rounded border border-dashed bg-muted/40 px-3 py-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Dev-mode invite link
                      </p>
                      <code className="break-all font-mono text-xs">{inviteUrl}</code>
                    </div>
                  )}

                  {/* Client Admin sliced worker view + §4.4 cross-company summary */}
                  {isClientAdmin && link.status === 'active' && (
                    <div className="border-t pt-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Workers ({workers.length})
                      </p>
                      {workers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No workers enrolled yet.</p>
                      ) : (
                        <ul className="space-y-2">
                          {workers.map((w, i) => {
                            const summary = summaryByUser.get(w.user_id)
                            return (
                              <li key={i} className="space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm text-muted-foreground">
                                    {w.invited_email ?? '—'}
                                  </span>
                                  <OnboardingBadge status={w.onboarding_status} />
                                </div>
                                {summary && summary.total_company_count > 1 && (
                                  <p className="text-xs text-muted-foreground">
                                    Works for {summary.total_company_count} companies
                                    {summary.shared_companies.length > 0 && (
                                      <> · Shared with you: {summary.shared_companies.join(', ')}</>
                                    )}
                                  </p>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })
          ) : allLinks.length > 0 ? (
            <p className="text-sm text-muted-foreground">No linked company does that. <Link href="/app/contractors" className="underline">Show all</Link></p>
          ) : (
            <p className="text-sm text-muted-foreground">No contractors linked yet.</p>
          )}
        </ul>
      </section>
    </div>
  )
}
