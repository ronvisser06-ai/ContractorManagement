import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { requireActiveOrg } from '@/lib/context/server'
import type { LinkStatus } from '@/lib/companies/labels'
import { requestLink } from '../actions'
import { AddCompanyForm, type OrgMemberOption } from './add-company-form'

interface Props {
  searchParams: Promise<{ q?: string; error?: string }>
}

interface Match {
  company_id: string
  legal_name: string
  link_status: LinkStatus | null
}

interface MemberUser {
  id: string
  given_name: string
  family_name: string
  primary_email: string
}

// What the search result means for this org (find_company_matches returns the
// org's own link status only; F1-2: no contacts or other clients).
function matchState(status: LinkStatus | null): { label: string; canRequest: boolean } {
  switch (status) {
    case 'active':
      return { label: 'Already linked', canRequest: false }
    case 'invited':
      return { label: 'Pending', canRequest: false }
    case 'declined':
      return { label: 'Declined — you can ask again', canRequest: true }
    case 'suspended':
      return { label: 'Suspended — you can ask again', canRequest: true }
    default:
      return { label: 'On the platform', canRequest: true }
  }
}

// F1 Step 2 / decision F1-6: search first, so an existing company is linked
// rather than duplicated. The create form only appears after a search.
export default async function NewContractorPage({ searchParams }: Props) {
  const { supabase, org, hasRole } = await requireActiveOrg()
  if (!hasRole('client_admin')) redirect('/app/contractors')

  const { q = '', error } = await searchParams
  const query = q.trim()
  const searched = query.length >= 2

  let matches: Match[] = []
  let searchError: string | null = null
  if (searched) {
    const { data, error: rpcErr } = await supabase.rpc('find_company_matches', { p_org_id: org.id, p_query: query })
    if (rpcErr) searchError = 'Search failed. Please try again.'
    else matches = (data ?? []) as Match[]
  }

  // In-house admin picker: the org's active members ("users: read if same org member").
  let members: OrgMemberOption[] = []
  if (searched) {
    const { data: mems } = await supabase
      .from('org_memberships')
      .select('user_id')
      .eq('org_id', org.id)
      .eq('status', 'active')
    const ids = (mems ?? []).map((m) => m.user_id as string)
    if (ids.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, given_name, family_name, primary_email')
        .in('id', ids)
      members = ((users ?? []) as MemberUser[])
        .map((u) => ({ email: u.primary_email, name: `${u.given_name} ${u.family_name}`.trim() }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/app/contractors" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Contractors
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add a contractor company</h1>
        <p className="text-sm text-muted-foreground">
          Search first — the company may already be on the platform. Linking to it avoids duplicates.
        </p>
      </div>

      {(error || searchError) && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error ?? searchError}
        </div>
      )}

      <form method="get" className="flex flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor="q" className="sr-only">
          Company name, business number or website
        </label>
        <Input
          id="q"
          name="q"
          defaultValue={query}
          placeholder="Company name, business number or website"
          autoFocus={!searched}
          className="flex-1"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {searched && (
        <section className="space-y-2" aria-label="Matching companies">
          <h2 className="text-sm font-medium text-muted-foreground">
            {matches.length > 0 ? `Companies already on the platform (${matches.length})` : 'No matching companies on the platform'}
          </h2>
          {matches.length > 0 && (
            <ul className="divide-y rounded-md border">
              {matches.map((m) => {
                const s = matchState(m.link_status)
                return (
                  <li key={m.company_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.legal_name}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                    {s.canRequest && (
                      <form action={requestLink}>
                        <input type="hidden" name="company_id" value={m.company_id} />
                        <input type="hidden" name="company_name" value={m.legal_name} />
                        <input type="hidden" name="q" value={query} />
                        <Button type="submit" size="sm">
                          Request link
                        </Button>
                      </form>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {matches.length > 0 && (
            <p className="text-xs text-muted-foreground">
              A link request is sent to the company&apos;s admin. You&apos;ll see the company once they accept.
            </p>
          )}
        </section>
      )}

      {searched && matches.length > 0 ? (
        // Matches found: keep "create" one deliberate click away so an existing
        // company isn't skipped past and duplicated (F1-6).
        <details className="group space-y-2">
          <summary className="cursor-pointer text-sm font-medium underline-offset-4 hover:underline">
            None of these — create a new company
          </summary>
          <div className="pt-2">
            <AddCompanyForm defaultName={query} members={members} />
          </div>
        </details>
      ) : searched ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Not on the platform yet — create it</h2>
          <AddCompanyForm defaultName={query} members={members} />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Search above to continue.</p>
      )}
    </div>
  )
}
