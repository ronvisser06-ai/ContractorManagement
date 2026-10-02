'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { sendEmail } from '@/lib/email/send'
import { requireActiveCompany } from '@/lib/context/server'
import { addCompanyAdmin } from '@/lib/companies/admins'
import { queueLink } from '@/lib/relatrix/queue'

const back = (q: string) => redirect(`/company/admins?${q}`)
const say = (key: 'error' | 'notice', text: string) => `${key}=${encodeURIComponent(text)}`

async function adminContext() {
  const ctx = await requireActiveCompany()
  if (!ctx.isContractorAdmin) redirect('/company/profile')
  return ctx
}

const field = (f: FormData, k: string) => ((f.get(k) as string | null) ?? '').trim()

export async function respondToLink(formData: FormData) {
  const { supabase } = await adminContext()
  const accept = field(formData, 'accept') === 'yes'
  const { error } = await supabase.rpc('respond_to_company_link', { p_link: field(formData, 'link_id'), p_accept: accept })
  if (error) back(say('error', error.message))
  if (accept) await queueLink(field(formData, 'link_id'))
  back(say('notice', accept ? 'Link accepted.' : 'Link declined.'))
}

export async function addAdmin(formData: FormData) {
  const { supabase, company } = await adminContext()
  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  const result = await addCompanyAdmin(
    { supabase, company: { id: company.id, name: company.name }, send: async (m) => (await sendEmail(m)).sent, origin: `${proto}://${host}` },
    { type: field(formData, 'admin_type'), email: field(formData, 'admin_email') },
  )
  if (result.kind === 'invalid') back(say('error', result.error))
  if (result.kind === 'invited' && result.invite) back(`invite_token=${result.invite.token}`)
  back(say('notice', 'Invitation sent.'))
}

export async function removeAdmin(formData: FormData) {
  const { supabase } = await adminContext()
  const { error } = await supabase.rpc('remove_company_admin', { p_membership: field(formData, 'membership_id') })
  if (error) back(say('error', error.message))
  back(say('notice', 'Admin removed.'))
}

export async function revokeInvite(formData: FormData) {
  const { supabase } = await adminContext()
  const { error } = await supabase.rpc('revoke_company_admin_invite', { p_invitation: field(formData, 'invitation_id') })
  if (error) back(say('error', error.message))
  back(say('notice', 'Invitation revoked.'))
}
