'use server'

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { newId } from '@/db/utils'

export async function inviteContractorCompany(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) redirect('/onboarding/create-org')

  // Application-layer role check; RLS on client_company_links also enforces this.
  const roles = membership.roles as string[]
  if (!roles.includes('client_admin')) {
    redirect('/app/contractors?error=Only+a+Client+Admin+can+invite+companies')
  }

  const contactEmail = ((formData.get('contact_email') as string | null) ?? '').trim().toLowerCase()
  if (!contactEmail) redirect('/app/contractors?error=Contact+email+is+required')

  // Reject a duplicate pending invite for the same email + org
  const { data: existing } = await supabase
    .from('invitations')
    .select('id')
    .eq('org_id', membership.org_id)
    .eq('email', contactEmail)
    .eq('type', 'company')
    .eq('status', 'pending')
    .maybeSingle()
  if (existing) {
    redirect('/app/contractors?error=A+pending+invite+already+exists+for+this+email')
  }

  // Stub contractor_companies row — legal_name + profile filled in at Step 3 registration.
  // Uses the admin client because the user-facing INSERT policy on contractor_companies
  // is restricted to service-role (company registration comes via SECURITY DEFINER RPC in Step 3).
  const admin = createAdminClient()
  const companyId = newId('cco_')
  const { error: coErr } = await admin.from('contractor_companies').insert({
    id: companyId,
    legal_name: `Invited: ${contactEmail}`,
    contact_email: contactEmail,
    status: 'active',
  })
  if (coErr) redirect(`/app/contractors?error=${encodeURIComponent(coErr.message)}`)

  // client_company_links — RLS enforces caller must be client_admin for org_id
  const linkId = newId('ccl_')
  const { error: linkErr } = await supabase.from('client_company_links').insert({
    id: linkId,
    org_id: membership.org_id,
    company_id: companyId,
    status: 'invited',
  })
  if (linkErr) {
    await admin.from('contractor_companies').delete().eq('id', companyId)
    redirect(`/app/contractors?error=${encodeURIComponent(linkErr.message)}`)
  }

  // Single-use, unguessable token — 32 random bytes → 64 hex chars
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error: invErr } = await supabase.from('invitations').insert({
    id: newId('inv_'),
    type: 'company',
    token,
    channel: 'email',
    email: contactEmail,
    org_id: membership.org_id,
    company_id: companyId,
    intended_roles: ['contractor_admin'],
    status: 'pending',
    expires_at: expiresAt,
    created_by: user.id,
  })
  if (invErr) {
    await admin.from('client_company_links').delete().eq('id', linkId)
    await admin.from('contractor_companies').delete().eq('id', companyId)
    redirect(`/app/contractors?error=${encodeURIComponent(invErr.message)}`)
  }

  // Dev-mode: log the link; it is also shown in the UI via invite_token searchParam.
  // Step 7 (Resend) replaces this with a real email delivery.
  console.log(`[DEV] Company invite for ${contactEmail}: /register/company?token=${token}`)

  redirect(`/app/contractors?invite_token=${token}`)
}
