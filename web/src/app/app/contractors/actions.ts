'use server'

import { randomBytes } from 'node:crypto'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { newId } from '@/db/utils'
import { requireActiveOrg } from '@/lib/context/server'
import { sendEmail, companyAdminInviteEmail } from '@/lib/email/send'
import { companyErrorMessage, isAdminType, isPossibleDuplicate } from '@/lib/companies/labels'

// F1 Step 2 — org-side company definition. All writes go through the
// SECURITY DEFINER RPCs from migration 0018; RLS no longer lets an org write
// links or company invitations directly.

async function baseUrl(): Promise<string> {
  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  return `${proto}://${host}`
}

const field = (formData: FormData, name: string) => ((formData.get(name) as string | null) ?? '').trim()

// Emails the nominated admin; returns whether it was delivered. When it isn't
// (no Resend key, or Resend refused the recipient), callers show the link.
async function deliverAdminInvite(opts: { to: string; token: string; companyName: string; orgName: string }) {
  const link = `${await baseUrl()}/invite/company?token=${opts.token}`
  const { html, text } = companyAdminInviteEmail({ link, companyName: opts.companyName, orgName: opts.orgName })
  const result = await sendEmail({
    to: opts.to,
    subject: `You've been nominated as administrator of ${opts.companyName}`,
    html,
    text,
  })
  return result.sent
}

function afterInvite(params: Record<string, string>, sent: boolean, token: string): never {
  const qs = new URLSearchParams(params)
  if (sent) qs.set('emailed', '1')
  else qs.set('invite_token', token)
  redirect(`/app/contractors?${qs.toString()}`)
}

// ── Create a new company + nominate its first admin ──────────────────────────

export interface AddCompanyState {
  error?: string
  possibleDuplicate?: boolean
  values?: Record<string, string>
}

const FORM_FIELDS = [
  'legal_name', 'trade_types', 'business_number', 'website',
  'contact_name', 'contact_email', 'contact_phone', 'admin_type', 'admin_email', 'staff_email',
] as const

export async function createCompany(_prev: AddCompanyState, formData: FormData): Promise<AddCompanyState> {
  const { supabase, org, hasRole } = await requireActiveOrg()
  const values = Object.fromEntries(FORM_FIELDS.map((f) => [f, field(formData, f)]))

  if (!hasRole('client_admin')) return { error: companyErrorMessage('not_client_admin'), values }

  const adminType = values.admin_type
  if (!isAdminType(adminType)) return { error: companyErrorMessage('admin_type_required'), values }
  // In-house admins are picked from the org's members; other types are typed in.
  const adminEmail = (adminType === 'client_staff' ? values.staff_email : values.admin_email).toLowerCase()
  if (!values.legal_name) return { error: companyErrorMessage('name_required'), values }
  if (!adminEmail) return { error: companyErrorMessage('admin_email_required'), values }

  const tradeTypes = values.trade_types
    ? values.trade_types.split(',').map((t) => t.trim()).filter(Boolean)
    : []
  const token = randomBytes(32).toString('hex')

  const { error } = await supabase.rpc('create_contractor_company', {
    p_org_id: org.id,
    p_company_id: newId('cco_'),
    p_link_id: newId('ccl_'),
    p_invitation_id: newId('inv_'),
    p_token: token,
    p_legal_name: values.legal_name,
    p_admin_email: adminEmail,
    p_admin_type: adminType,
    p_trade_types: tradeTypes,
    p_contact_name: values.contact_name || null,
    p_contact_email: values.contact_email || null,
    p_contact_phone: values.contact_phone || null,
    p_business_number: values.business_number || null,
    p_website: values.website || null,
    p_confirm_not_duplicate: formData.get('confirm_not_duplicate') === 'on',
  })
  if (error) {
    return {
      error: companyErrorMessage(error.message),
      possibleDuplicate: isPossibleDuplicate(error.message),
      values,
    }
  }

  const sent = await deliverAdminInvite({ to: adminEmail, token, companyName: values.legal_name, orgName: org.name })
  afterInvite({ created: values.legal_name }, sent, token)
}

// ── Ask an existing company to link (the company must accept) ───────────────

export async function requestLink(formData: FormData) {
  const { supabase, org, hasRole } = await requireActiveOrg()
  const companyId = field(formData, 'company_id')
  const companyName = field(formData, 'company_name')
  const back = field(formData, 'q')
  if (!hasRole('client_admin')) redirect('/app/contractors?error=' + encodeURIComponent(companyErrorMessage('not_client_admin')))

  const { error } = await supabase.rpc('request_company_link', {
    p_org_id: org.id,
    p_company_id: companyId,
    p_link_id: newId('ccl_'),
  })
  if (error) {
    const qs = new URLSearchParams({ error: companyErrorMessage(error.message) })
    if (back) qs.set('q', back)
    redirect(`/app/contractors/new?${qs.toString()}`)
  }
  redirect(`/app/contractors?requested=${encodeURIComponent(companyName)}`)
}

// ── Pending admin nomination: re-send (fresh link) or replace ────────────────

async function renominate(formData: FormData, email: string, adminType: string, param: 'resent' | 'replaced') {
  const { supabase, org, hasRole } = await requireActiveOrg()
  const companyId = field(formData, 'company_id')
  const companyName = field(formData, 'company_name')
  if (!hasRole('client_admin')) redirect('/app/contractors?error=' + encodeURIComponent(companyErrorMessage('not_client_admin')))
  if (!email) redirect('/app/contractors?error=' + encodeURIComponent(companyErrorMessage('admin_email_required')))
  if (!isAdminType(adminType)) redirect('/app/contractors?error=' + encodeURIComponent(companyErrorMessage('admin_type_required')))

  const token = randomBytes(32).toString('hex')
  const { error } = await supabase.rpc('replace_admin_nomination', {
    p_org_id: org.id,
    p_company_id: companyId,
    p_invitation_id: newId('inv_'),
    p_token: token,
    p_email: email.toLowerCase(),
    p_admin_type: adminType,
  })
  if (error) redirect('/app/contractors?error=' + encodeURIComponent(companyErrorMessage(error.message)))

  const sent = await deliverAdminInvite({ to: email.toLowerCase(), token, companyName, orgName: org.name })
  afterInvite({ [param]: companyName }, sent, token)
}

// Same person and type, new link (the old one is revoked; 7 more days).
export async function resendNomination(formData: FormData) {
  await renominate(formData, field(formData, 'email'), field(formData, 'admin_type'), 'resent')
}

// A different person and/or admin type.
export async function replaceNomination(formData: FormData) {
  await renominate(formData, field(formData, 'new_email'), field(formData, 'new_admin_type'), 'replaced')
}
