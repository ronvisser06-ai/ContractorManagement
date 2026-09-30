// Membership context — pure types and selection logic (F0, Step 1).
// No imports on purpose: node:test imports this file directly.
//
// The active org/company is a *selection among memberships the user already
// holds*. It never grants access — RLS remains the enforcement layer.

export type OrgRole = 'client_admin' | 'content_developer' | 'content_approver' | 'foreman'
export type CompanyRole = 'contractor_admin' | 'worker'

export interface OrgContext {
  id: string // org_id
  membershipId: string
  name: string
  roles: OrgRole[]
}

export interface CompanyContext {
  id: string // company_id
  membershipId: string
  name: string
  roles: CompanyRole[]
}

export interface MyMemberships {
  orgs: OrgContext[] // ordered by membership created_at
  companies: CompanyContext[] // ordered by membership created_at
}

export type ContextKind = 'org' | 'company'

export const CONTEXT_COOKIE: Record<ContextKind, string> = {
  org: 'ctx_org',
  company: 'ctx_company',
}

const CONTEXT_COOKIE_MAX_AGE = 60 * 60 * 24 * 180 // 180 days

export function contextCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
    maxAge: CONTEXT_COOKIE_MAX_AGE,
  }
}

export const ROLE_LABEL: Record<OrgRole | CompanyRole, string> = {
  client_admin: 'Client Admin',
  content_developer: 'Content Developer',
  content_approver: 'Content Approver',
  foreman: 'Site Foreman',
  contractor_admin: 'Contractor Admin',
  worker: 'Worker',
}

export type Landing = '/app' | '/company' | '/onboarding/create-org' | 'chooser'

/**
 * Where a signed-in user lands at `/`. Exactly one membership overall → that
 * portal; several → the chooser; none → create an organization. Never points
 * at a portal the user has no membership in, so it can't start a redirect loop.
 */
export function landingFor({ orgs, companies }: MyMemberships): Landing {
  const total = orgs.length + companies.length
  if (total === 0) return '/onboarding/create-org'
  if (total > 1) return 'chooser'
  return orgs.length === 1 ? '/app' : '/company'
}

/**
 * Pick the active membership: the one named by the cookie if the user actually
 * holds it, otherwise the first (oldest) one. A forged or stale cookie falls
 * back to the default and can never select something outside `list`.
 */
export function resolveActive<T extends { id: string }>(
  list: readonly T[],
  cookieValue: string | undefined,
): T | null {
  if (list.length === 0) return null
  if (cookieValue) {
    const match = list.find((m) => m.id === cookieValue)
    if (match) return match
  }
  return list[0]
}
