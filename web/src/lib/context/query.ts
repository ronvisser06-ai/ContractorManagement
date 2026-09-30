// Membership context — load every active org and company membership for a user.
// Takes the Supabase client as a parameter (no Next.js imports) so it runs the
// same in server code and in node:test with a signed-in user's client.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CompanyContext, CompanyRole, MyMemberships, OrgContext, OrgRole } from './resolve.ts'

interface OrgMembershipRow {
  id: string
  org_id: string
  roles: OrgRole[]
  organizations: { name: string } | { name: string }[] | null
}

interface CompanyMembershipRow {
  id: string
  company_id: string
  roles: CompanyRole[]
  contractor_companies: { legal_name: string } | { legal_name: string }[] | null
}

// PostgREST returns a to-one embed as an object, but the untyped client's
// inference says array — accept both.
function one<T>(embed: T | T[] | null): T | null {
  if (Array.isArray(embed)) return embed[0] ?? null
  return embed
}

export async function getMyMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<MyMemberships> {
  const [orgResult, companyResult] = await Promise.all([
    supabase
      .from('org_memberships')
      .select('id, org_id, roles, organizations(name)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
    supabase
      .from('company_memberships')
      .select('id, company_id, roles, contractor_companies(legal_name)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
  ])

  if (orgResult.error) throw new Error(`org_memberships: ${orgResult.error.message}`)
  if (companyResult.error) throw new Error(`company_memberships: ${companyResult.error.message}`)

  const orgs: OrgContext[] = ((orgResult.data ?? []) as unknown as OrgMembershipRow[]).map((r) => ({
    id: r.org_id,
    membershipId: r.id,
    name: one(r.organizations)?.name ?? 'Unnamed organization',
    roles: r.roles ?? [],
  }))

  const companies: CompanyContext[] = (
    (companyResult.data ?? []) as unknown as CompanyMembershipRow[]
  ).map((r) => ({
    id: r.company_id,
    membershipId: r.id,
    name: one(r.contractor_companies)?.legal_name ?? 'Unnamed company',
    roles: r.roles ?? [],
  }))

  return { orgs, companies }
}
