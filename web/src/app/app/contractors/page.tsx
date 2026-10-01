import Link from 'next/link'
import { headers } from 'next/headers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestLink, replaceNomination, resendNomination } from './actions'
import { requireActiveOrg } from '@/lib/context/server'
import {
  ADMIN_TYPES,
  ADMIN_TYPE_LABEL,
  linkStatusLabel,
  type AdminType,
  type LinkStatus,
} from '@/lib/companies/labels'

interface Props {
  searchParams: Promise<{
    error?: string
    invite_token?: string
    emailed?: string
    created?: string
    requested?: string
    resent?: string
    replaced?: string
  }>
}

// org_company_links (migration 0018): names for every link status — RLS alone
// hides companies the org only *requested*.
interface OrgLink {
  link_id: string
  company_id: string
  legal_name: string
  status: LinkStatus
  invited_at: string
}

interface CompanyRow {
  id: string
  contact_email: string | null
  created_by_org_id: string | null
}

interface Nomination {
  company_id: string
  email: string
  admin_type: AdminType | null
  expires_at: string
  token: string
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

const LINK_STATUS_STYLES: Record<LinkStatus, string> = {
  invited: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  declined: 'bg-muted text-muted-foreground',
}

const ONBOARDING_STYLES: Record<string, string> = {
  entered: 'bg-blue-100 text-blue-800',
  invited: 'bg-yellow-100 text-yellow-800',
  logged_in: 'bg-indigo-100 text-indigo-800',
  account_created: 'bg-green-100 text-green-800',
}

function StatusBadge({ status, createdByUs }: { status: LinkStatus; createdByUs: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${LINK_STATUS_STYLES[status]}`}>
      {linkStatusLabel(status, createdByUs)}
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

function Banner({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'border-green-200 bg-green-50 text-green-900'
      : 'border-destructive/50 bg-destructive/10 text-destructive'
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>
}

export default async function ContractorsPage({ searchParams }: Props) {
  const { supabase, org, hasRole } = await requireActiveOrg()
  const isClientAdmin = hasRole('client_admin')

  const { data: rawLinks } = await supabase.rpc('org_company_links', { p_org_id: org.id })
  const links = (rawLinks ?? []) as OrgLink[]
  const companyIds = links.map((l) => l.company_id)

  // Profile details where RLS allows (active links, or companies we created).
  const companyById = new Map<string, CompanyRow>()
  if (companyIds.length > 0) {
    const { data } = await supabase
      .from('contractor_companies')
      .select('id, contact_email, created_by_org_id')
      .in('id', companyIds)
    for (const c of (data ?? []) as CompanyRow[]) companyById.set(c.id, c)
  }

  // Pending admin nominations this org made (re-send / replace while unaccepted).
  const nominationByCompany = new Map<string, Nomination>()
  if (isClientAdmin) {
    const { data } = await supabase
      .from('invitations')
      .select('company_id, email, admin_type, expires_at, token')
      .eq('org_id', org.id)
      .eq('type', 'company')
      .eq('status', 'pending')
    for (const n of (data ?? []) as Nomination[]) nominationByCompany.set(n.company_id, n)
  }

  // Client Admin sliced worker view: workers for active linked companies.
  // RLS "company_memberships: read if member or linked" permits linked client orgs.
  const activeCompanyIds = links.filter((l) => l.status === 'active').map((l) => l.company_id)
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

    // §4.4 cross-company summary for workers who have completed registration.
    const registeredUserIds = [
      ...new Set(workers.filter((w) => w.onboarding_status === 'account_created').map((w) => w.user_id)),
    ]
    await Promise.all(
      registeredUserIds.map(async (userId) => {
        const { data } = await supabase.rpc('worker_company_summary', { p_worker_id: userId })
        if (data) summaryByUser.set(userId, data as WorkerCompanySummary)
      }),
    )
  }

  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  const inviteUrl = (token: string) => `${proto}://${host}/invite/company?token=${token}`

  const params = await searchParams
  const subject = params.created ?? params.resent ?? params.replaced
  const verb = params.created ? 'created' : params.resent ? 're-sent the invitation for' : 'replaced the admin nomination for'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Contractors</h1>
        {isClientAdmin && (
          <Button asChild>
            <Link href="/app/contractors/new">Add a contractor company</Link>
          </Button>
        )}
      </div>

      {params.error && <Banner tone="error">{params.error}</Banner>}

      {subject && (
        <Banner tone="ok">
          <p>
            You {verb} <strong>{subject}</strong>.{' '}
            {params.emailed
              ? 'The nominated admin has been emailed an invitation.'
              : 'The invitation email could not be sent — share this link with the nominated admin (it only works for their email address):'}
          </p>
          {params.invite_token && (
            <code className="mt-1.5 block break-all font-mono text-xs">{inviteUrl(params.invite_token)}</code>
          )}
        </Banner>
      )}

      {params.requested && (
        <Banner tone="ok">
          Link request sent to <strong>{params.requested}</strong>. You&apos;ll see the company once its admin accepts.
        </Banner>
      )}

      <section className="space-y-2">
        {links.length > 0 && <h2 className="text-sm font-medium text-muted-foreground">Your contractor companies</h2>}
        {links.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No contractor companies yet.{isClientAdmin && ' Use "Add a contractor company" to find or create one.'}
          </p>
        )}
        <ul className="space-y-3">
          {links.map((link) => {
            const co = companyById.get(link.company_id)
            const createdByUs = co?.created_by_org_id === org.id
            const nomination = nominationByCompany.get(link.company_id)
            const workers = workersByCompany.get(link.company_id) ?? []

            return (
              <li key={link.link_id} className="space-y-3 rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{link.legal_name}</p>
                    {co?.contact_email && <p className="text-sm text-muted-foreground">{co.contact_email}</p>}
                  </div>
                  <StatusBadge status={link.status} createdByUs={createdByUs} />
                </div>

                {link.status === 'invited' && !createdByUs && (
                  <p className="text-xs text-muted-foreground">Waiting for the company&apos;s admin to accept your link request.</p>
                )}

                {link.status === 'declined' && isClientAdmin && (
                  <form action={requestLink} className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">The company declined your link request.</p>
                    <input type="hidden" name="company_id" value={link.company_id} />
                    <input type="hidden" name="company_name" value={link.legal_name} />
                    <Button type="submit" size="sm" variant="outline">
                      Ask again
                    </Button>
                  </form>
                )}

                {/* Pending first-admin nomination (only while the company has no admin) */}
                {nomination && isClientAdmin && (
                  <div className="space-y-2 rounded border border-dashed bg-muted/40 px-3 py-2">
                    <p className="text-xs">
                      <span className="font-medium">Admin invited:</span> {nomination.email}
                      {nomination.admin_type && <> · {ADMIN_TYPE_LABEL[nomination.admin_type]}</>} · expires{' '}
                      {new Date(nomination.expires_at).toLocaleDateString()}
                    </p>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Show invitation link</summary>
                      <code className="mt-1 block break-all font-mono">{inviteUrl(nomination.token)}</code>
                    </details>
                    <div className="flex flex-wrap items-end gap-2">
                      <form action={resendNomination}>
                        <input type="hidden" name="company_id" value={link.company_id} />
                        <input type="hidden" name="company_name" value={link.legal_name} />
                        <input type="hidden" name="email" value={nomination.email} />
                        <input type="hidden" name="admin_type" value={nomination.admin_type ?? 'company_staff'} />
                        <Button type="submit" size="sm" variant="outline">
                          Re-send
                        </Button>
                      </form>
                      <details className="w-full sm:w-auto">
                        <summary className="cursor-pointer text-xs text-muted-foreground">Replace with someone else…</summary>
                        <form action={replaceNomination} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                          <input type="hidden" name="company_id" value={link.company_id} />
                          <input type="hidden" name="company_name" value={link.legal_name} />
                          <div className="space-y-1">
                            <Label htmlFor={`new_email_${link.company_id}`} className="text-xs">
                              Email
                            </Label>
                            <Input id={`new_email_${link.company_id}`} name="new_email" type="email" required className="h-8" />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`new_type_${link.company_id}`} className="text-xs">
                              Admin type
                            </Label>
                            <select
                              id={`new_type_${link.company_id}`}
                              name="new_admin_type"
                              defaultValue="company_staff"
                              className="h-8 rounded-md border bg-background px-2 text-sm"
                            >
                              {ADMIN_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <Button type="submit" size="sm">
                            Replace
                          </Button>
                        </form>
                      </details>
                    </div>
                  </div>
                )}

                {/* Client Admin sliced worker view + §4.4 cross-company summary */}
                {isClientAdmin && link.status === 'active' && (
                  <div className="border-t pt-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Workers ({workers.length})</p>
                    {workers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No workers enrolled yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {workers.map((w, i) => {
                          const summary = summaryByUser.get(w.user_id)
                          return (
                            <li key={i} className="space-y-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm text-muted-foreground">{w.invited_email ?? '—'}</span>
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
          })}
        </ul>
      </section>
    </div>
  )
}
