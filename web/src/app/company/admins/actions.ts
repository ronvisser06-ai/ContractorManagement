'use server'

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { newId } from '@/db/utils'
import { requireActiveCompany } from '@/lib/context/server'
import { sendEmail, companyAdminInviteEmail } from '@/lib/email/send'
import { companyErrorMessage, isAdminType } from '@/lib/companies/labels'
import { requestBaseUrl } from '@/lib/http/base-url'
import { invitePath } from '@/lib/http/safe-next'

// F1 Step 4 — a company's admins manage its admins (decision F1-3). All checks
// (caller is admin of this company; never remove the last admin) live in the
// 0018 RPCs; these actions only route and deliver the email.

const fail = (code: string | undefined): never =>
  redirect(`/company/admins?error=${encodeURIComponent(companyErrorMessage(code))}`)

async function requireAdmin() {
  const ctx = await requireActiveCompany()
  if (!ctx.isContractorAdmin) redirect('/company/profile')
  return ctx
}

export async function inviteAdmin(formData: FormData) {
  const { supabase, user, company } = await requireAdmin()
  const email = ((formData.get('email') as string | null) ?? '').trim().toLowerCase()
  const adminType = formData.get('admin_type')
  if (!email) fail('admin_email_required')
  if (!isAdminType(adminType)) fail('admin_type_required')

  const token = randomBytes(32).toString('hex')
  const { error } = await supabase.rpc('invite_company_admin', {
    p_company_id: company.id,
    p_invitation_id: newId('inv_'),
    p_token: token,
    p_email: email,
    p_admin_type: adminType,
  })
  if (error) fail(error.message)

  const { data: me } = await supabase.from('users').select('given_name, family_name').eq('id', user.id).maybeSingle()
  const inviter = me ? `${me.given_name} ${me.family_name}`.trim() : company.name
  const link = `${await requestBaseUrl()}${invitePath(token)}`
  const { html, text } = companyAdminInviteEmail({ link, companyName: company.name, invitedBy: inviter, kind: 'admin_invite' })
  const { sent } = await sendEmail({ to: email, subject: `You've been invited to administer ${company.name}`, html, text })

  const qs = new URLSearchParams({ invited: email })
  if (!sent) qs.set('invite_token', token)
  redirect(`/company/admins?${qs.toString()}`)
}

export async function revokeAdminInvite(formData: FormData) {
  const { supabase, company } = await requireAdmin()
  const invitationId = ((formData.get('invitation_id') as string | null) ?? '').trim()
  // RLS "invitations: update if admin" limits this to this company's invitations.
  const { error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId)
    .eq('company_id', company.id)
    .eq('type', 'company')
    .eq('status', 'pending')
  if (error) fail(error.message)
  redirect('/company/admins?revoked=1')
}

export async function removeAdmin(formData: FormData) {
  const { supabase, user } = await requireAdmin()
  const membershipId = ((formData.get('membership_id') as string | null) ?? '').trim()
  const isSelf = formData.get('user_id') === user.id
  const name = ((formData.get('name') as string | null) ?? '').trim()

  const { error } = await supabase.rpc('remove_company_admin', { p_membership_id: membershipId })
  if (error) fail(error.message)

  // Removing yourself ends your admin access to this company → landing router.
  if (isSelf) redirect('/')
  redirect(`/company/admins?removed=${encodeURIComponent(name)}`)
}
