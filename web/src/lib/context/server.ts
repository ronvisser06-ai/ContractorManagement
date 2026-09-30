// Membership context — server helpers for layouts, pages and server actions.
// Reads the ctx_* cookies but never writes them: cookies can't be set during
// Server Component render, so switching goes through switchContext (actions.ts).

import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyMemberships } from './query'
import {
  CONTEXT_COOKIE,
  resolveActive,
  type CompanyContext,
  type OrgContext,
  type OrgRole,
} from './resolve'

// Wrapped in React cache: a layout and its page share one lookup per request.
export const getMembershipContext = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { orgs, companies } = await getMyMemberships(supabase, user.id)
  const cookieStore = await cookies()

  return {
    supabase,
    user,
    orgs,
    companies,
    activeOrg: resolveActive(orgs, cookieStore.get(CONTEXT_COOKIE.org)?.value),
    activeCompany: resolveActive(companies, cookieStore.get(CONTEXT_COOKIE.company)?.value),
  }
})

/**
 * Contractor portal entry point: the signed-in user's active company, or a
 * redirect (signed out → /login; no company membership → the landing router).
 */
export async function requireActiveCompany() {
  const ctx = await getMembershipContext()
  if (!ctx) redirect('/login')
  if (!ctx.activeCompany) redirect('/')
  const company = ctx.activeCompany
  return { ...ctx, company, isContractorAdmin: company.roles.includes('contractor_admin') }
}

/**
 * Client portal entry point: the signed-in user's active org, or a redirect
 * (signed out → /login; no org membership → the landing router).
 */
export async function requireActiveOrg() {
  const ctx = await getMembershipContext()
  if (!ctx) redirect('/login')
  if (!ctx.activeOrg) redirect('/')
  const org = ctx.activeOrg
  return { ...ctx, org, hasRole: (role: OrgRole) => org.roles.includes(role) }
}

export type MembershipContext = NonNullable<Awaited<ReturnType<typeof getMembershipContext>>>

export async function getActiveOrg(): Promise<{
  active: OrgContext | null
  all: OrgContext[]
} | null> {
  const ctx = await getMembershipContext()
  if (!ctx) return null
  return { active: ctx.activeOrg, all: ctx.orgs }
}

export async function getActiveCompany(): Promise<{
  active: CompanyContext | null
  all: CompanyContext[]
} | null> {
  const ctx = await getMembershipContext()
  if (!ctx) return null
  return { active: ctx.activeCompany, all: ctx.companies }
}
