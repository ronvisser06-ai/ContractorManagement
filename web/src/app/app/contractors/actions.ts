'use server'

import { randomBytes } from 'node:crypto'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { newId } from '@/db/utils'
import { sendEmail, companyInviteEmail } from '@/lib/email/send'
import { requireActiveOrg } from '@/lib/context/server'

export async function inviteContractorCompany(formData: FormData) {
  // Acts on the user's *active* org, with their roles in that org (F0).
  const { supabase, user, org, hasRole } = await requireActiveOrg()

  // Application-layer role check; RLS on client_company_links also enforces this.
  if (!hasRole('client_admin')) {
    redirect('/app/contractors?error=Only+a+Client+Admin+can+invite+companies')
  }

  const contactEmail = ((formData.get('contact_email') as string | null) ?? '').trim().toLowerCase()
  if (!contactEmail) redirect('/app/contractors?error=Contact+email+is+required')

  // Reject a duplicate pending invite for the same email + org
  const { data: existing } = await supabase
    .from('invitations')
    .select('id')
    .eq('org_id', org.id)
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
    // Required by the 0018 link/invitation policies (org may only invite for
    // companies it created). This stub path is replaced in F1 Step 2.
    created_by_org_id: org.id,
  })
  if (coErr) redirect(`/app/contractors?error=${encodeURIComponent(coErr.message)}`)

  // client_company_links — RLS enforces caller must be client_admin for org_id
  const linkId = newId('ccl_')
  const { error: linkErr } = await supabase.from('client_company_links').insert({
    id: linkId,
    org_id: org.id,
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
    org_id: org.id,
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

  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  const link = `${proto}://${host}/register/company?token=${token}`

  const { html, text } = companyInviteEmail(link)
  const result = await sendEmail({
    to: contactEmail,
    subject: "You've been invited to register as a contractor company",
    html,
    text,
  })

  if (result.sent) {
    redirect('/app/contractors?invited=1')
  } else {
    console.log(`[DEV] Company invite for ${contactEmail}: ${link}`)
    redirect(`/app/contractors?invite_token=${token}`)
  }
}
