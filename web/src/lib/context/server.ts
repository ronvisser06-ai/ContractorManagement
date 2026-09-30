// Membership context — server helpers for layouts, pages and server actions.
// Reads the ctx_* cookies but never writes them: cookies can't be set during
// Server Component render, so switching goes through switchContext (actions.ts).

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getMyMemberships } from './query'
import {
  CONTEXT_COOKIE,
  resolveActive,
  type CompanyContext,
  type OrgContext,
} from './resolve'

export async function getMembershipContext() {
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
