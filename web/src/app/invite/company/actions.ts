'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { newId } from '@/db/utils'
import { createClient } from '@/lib/supabase/server'
import { CONTEXT_COOKIE, contextCookieOptions } from '@/lib/context/resolve'
import { companyErrorMessage } from '@/lib/companies/labels'
import { invitePath } from '@/lib/http/safe-next'

// F1 Step 3 — accept a company-admin invitation. The RPC checks the token,
// that the signed-in email matches the invitation (F1-5) and ownership
// (takeover guard); here we only route the user and open the company.

type Supabase = Awaited<ReturnType<typeof createClient>>

const back = (token: string, error: string): never =>
  redirect(`${invitePath(token)}&error=${encodeURIComponent(error)}`)

async function acceptAndOpen(supabase: Supabase, token: string): Promise<never> {
  const { data: companyId, error } = await supabase.rpc('accept_company_admin_invite', {
    p_token: token,
    p_membership_id: newId('mem_'),
  })
  if (error || typeof companyId !== 'string') back(token, companyErrorMessage(error?.message))

  // Open the new company in the contractor portal (F0 active context).
  const cookieStore = await cookies()
  cookieStore.set(CONTEXT_COOKIE.company, companyId as string, contextCookieOptions(process.env.NODE_ENV === 'production'))
  redirect('/company')
}

// Signed in with the invited email → accept.
export async function acceptInvite(formData: FormData) {
  const token = ((formData.get('token') as string | null) ?? '').trim()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(invitePath(token))}`)
  await acceptAndOpen(supabase, token)
}

// Signed in as someone else → sign out and come back to sign in properly.
export async function switchAccount(formData: FormData) {
  const token = ((formData.get('token') as string | null) ?? '').trim()
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect(`/login?next=${encodeURIComponent(invitePath(token))}`)
}

// New to the platform → create the account for the invited email, then accept.
export async function createAccountAndAccept(formData: FormData) {
  const token = ((formData.get('token') as string | null) ?? '').trim()
  const givenName = ((formData.get('given_name') as string | null) ?? '').trim()
  const familyName = ((formData.get('family_name') as string | null) ?? '').trim()
  const password = (formData.get('password') as string | null) ?? ''

  if (!givenName || !familyName) back(token, 'Enter your first and last name.')
  if (password.length < 8) back(token, 'Password must be at least 8 characters.')

  const supabase = await createClient()
  // The account is always created for the invited address — never a form value.
  const { data: rows } = await supabase.rpc('get_company_invitation', { p_token: token })
  const inv = (rows as { email: string; status: string; expired: boolean }[] | null)?.[0]
  if (!inv) back(token, companyErrorMessage('invalid_token'))
  if (inv!.status !== 'pending') back(token, companyErrorMessage('already_used'))
  if (inv!.expired) back(token, companyErrorMessage('expired'))

  const { data, error } = await supabase.auth.signUp({
    email: inv!.email,
    password,
    options: { data: { given_name: givenName, family_name: familyName } },
  })
  if (error) {
    const exists = /already (registered|exists)/i.test(error.message)
    back(token, exists ? 'You already have an account with this email — sign in instead.' : error.message)
  }
  if (!data.session) {
    // Email confirmation is on for this project: confirm, then use the link again.
    redirect(`${invitePath(token)}&confirm=1`)
  }
  await acceptAndOpen(supabase, token)
}
