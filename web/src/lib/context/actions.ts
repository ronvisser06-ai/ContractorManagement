'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getMembershipContext } from './server'
import { CONTEXT_COOKIE, contextCookieOptions, type ContextKind } from './resolve'

const PORTAL_HOME: Record<ContextKind, string> = { org: '/app', company: '/company' }

// Switch the active org or company. Re-checks the id against the user's own
// memberships so the cookie can only ever name something they already hold.
export async function switchContext(formData: FormData) {
  const kind = formData.get('kind')
  const id = ((formData.get('id') as string | null) ?? '').trim()

  if (kind !== 'org' && kind !== 'company') redirect('/?error=Unknown+context')

  const ctx = await getMembershipContext()
  if (!ctx) redirect('/login')

  const list = kind === 'org' ? ctx.orgs : ctx.companies
  if (!id || !list.some((m) => m.id === id)) {
    redirect('/?error=You+are+not+a+member+of+that+' + (kind === 'org' ? 'organization' : 'company'))
  }

  const cookieStore = await cookies()
  cookieStore.set(CONTEXT_COOKIE[kind], id, contextCookieOptions(process.env.NODE_ENV === 'production'))

  redirect(PORTAL_HOME[kind])
}
