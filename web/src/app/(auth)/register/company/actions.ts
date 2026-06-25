'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { newId } from '@/db/utils'

export async function registerFromCompanyInvite(formData: FormData) {
  const token = ((formData.get('token') as string | null) ?? '').trim()
  const givenName = ((formData.get('given_name') as string | null) ?? '').trim()
  const familyName = ((formData.get('family_name') as string | null) ?? '').trim()
  const email = ((formData.get('email') as string | null) ?? '').trim().toLowerCase()
  const password = (formData.get('password') as string | null) ?? ''
  const legalName = ((formData.get('legal_name') as string | null) ?? '').trim()

  const errBase = `/register/company?token=${encodeURIComponent(token)}&error=`

  if (!token) redirect('/register/company?error=Missing+invite+token')
  if (!givenName || !familyName) redirect(`${errBase}${encodeURIComponent('Name is required')}`)
  if (!email) redirect(`${errBase}${encodeURIComponent('Email is required')}`)
  if (!legalName) redirect(`${errBase}${encodeURIComponent('Company name is required')}`)
  if (password.length < 8) redirect(`${errBase}${encodeURIComponent('Password must be at least 8 characters')}`)

  const admin = createAdminClient()

  // Re-validate the token before creating the auth user (defensive; the page
  // already checked, but form submission could lag past expiry).
  const { data: inv, error: invErr } = await admin
    .from('invitations')
    .select('status, expires_at, company_id')
    .eq('token', token)
    .eq('type', 'company')
    .maybeSingle()

  if (invErr || !inv) {
    redirect(`${errBase}${encodeURIComponent('Invalid invite link')}`)
  }
  if (inv.status !== 'pending') {
    redirect(`${errBase}${encodeURIComponent('This invite has already been used')}`)
  }
  if (new Date(inv.expires_at) < new Date()) {
    redirect(`${errBase}${encodeURIComponent('This invite has expired')}`)
  }

  // Create the Supabase auth user. handle_new_user trigger fires synchronously
  // and creates the public.users row before signUp() returns.
  const supabase = await createClient()
  const { data: authData, error: signUpErr } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { given_name: givenName, family_name: familyName } },
  })

  if (signUpErr || !authData.user) {
    redirect(`${errBase}${encodeURIComponent(signUpErr?.message ?? 'Signup failed')}`)
  }

  const userId = authData.user.id
  const membershipId = newId('mem_')

  // Accept the invite atomically: update stub company, create membership, flip link.
  // Uses admin client so this works regardless of whether a session was issued
  // (email confirmation may be enabled on this Supabase project).
  const { error: rpcErr } = await admin.rpc('accept_company_invite', {
    p_token: token,
    p_user_id: userId,
    p_membership_id: membershipId,
    p_legal_name: legalName,
  })

  if (rpcErr) {
    // Roll back the auth user so the invite token can be retried.
    await admin.auth.admin.deleteUser(userId)
    redirect(`${errBase}${encodeURIComponent(rpcErr.message)}`)
  }

  // Session is available when email confirmation is OFF (current dev setup).
  if (authData.session) {
    redirect('/company/profile')
  }

  // Email confirmation ON: the user must confirm before they can log in.
  // Their membership is already created — they'll see the company portal on first login.
  redirect('/register/company?registered=1')
}
