import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { requireActiveCompany } from '@/lib/context/server'
import type { LinkStatus } from '@/lib/companies/labels'
import { respondToRequest } from './actions'

interface Props {
  searchParams: Promise<{ error?: string; accepted?: string; declined?: string }>
}

// company_client_links (migration 0020): org names for this company's links,
// visible to the company's admins only.
interface ClientLink {
  link_id: string
  org_name: string
  status: LinkStatus
  invited_at: string
  accepted_at: string | null
}

const STATUS_TEXT: Record<Exclude<LinkStatus, 'invited'>, { label: string; cls: string }> = {
  active: { label: 'Linked', cls: 'bg-green-100 text-green-800' },
  declined: { label: 'Declined', cls: 'bg-muted text-muted-foreground' },
  suspended: { label: 'Suspended', cls: 'bg-red-100 text-red-800' },
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '')

export default async function CompanyClientsPage({ searchParams }: Props) {
  const { supabase, company, isContractorAdmin } = await requireActiveCompany()
  if (!isContractorAdmin) redirect('/company/profile')

  const { data } = await supabase.rpc('company_client_links', { p_company_id: company.id })
  const links = (data ?? []) as ClientLink[]
  const requests = links.filter((l) => l.status === 'invited')
  const others = links.filter((l) => l.status !== 'invited')
  const { error, accepted, declined } = await searchParams

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">
          Client organizations that work with {company.name}. A client only sees your company and its workers after you
          accept its request.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}
      {accepted && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <strong>{accepted}</strong> is now linked to {company.name} and can see your company and its workers.
        </div>
      )}
      {declined && (
        <div className="rounded-md border px-4 py-3 text-sm">
          You declined <strong>{declined}</strong>&apos;s request. They can ask again later.
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Link requests{requests.length > 0 && ` (${requests.length})`}
        </h2>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending requests.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {requests.map((r) => (
              <li key={r.link_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.org_name}</p>
                  <p className="text-xs text-muted-foreground">Asked to link on {fmt(r.invited_at)}</p>
                </div>
                <div className="flex gap-2">
                  {(['accept', 'decline'] as const).map((decision) => (
                    <form key={decision} action={respondToRequest}>
                      <input type="hidden" name="link_id" value={r.link_id} />
                      <input type="hidden" name="org_name" value={r.org_name} />
                      <input type="hidden" name="decision" value={decision} />
                      <Button type="submit" size="sm" variant={decision === 'accept' ? 'default' : 'outline'}>
                        {decision === 'accept' ? 'Accept' : 'Decline'}
                      </Button>
                    </form>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Your clients</h2>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clients yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {others.map((l) => {
              const s = STATUS_TEXT[l.status as Exclude<LinkStatus, 'invited'>]
              return (
                <li key={l.link_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.org_name}</p>
                    {l.accepted_at && <p className="text-xs text-muted-foreground">Linked since {fmt(l.accepted_at)}</p>}
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
