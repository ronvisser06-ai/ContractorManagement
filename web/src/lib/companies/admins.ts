// A company's own admins add another admin by email (M2.5 F1c). Like define.ts it imports nothing from Next.

import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { newId } from '../../db/utils.ts'
import type { Mail } from './define.ts'

export type InviteType = 'external' | 'third_party'

export type AddAdminResult =
  | { kind: 'invalid'; error: string }
  | { kind: 'invited'; invite: { token: string; email: string } | null }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function addCompanyAdmin(
  d: { supabase: SupabaseClient; company: { id: string; name: string }; send: (m: Mail) => Promise<boolean>; origin: string },
  input: { type: string; email: string },
): Promise<AddAdminResult> {
  const email = input.email.trim().toLowerCase()
  if (input.type !== 'external' && input.type !== 'third_party') return { kind: 'invalid', error: 'Choose who this person is.' }
  if (!EMAIL.test(email)) return { kind: 'invalid', error: 'Enter the person’s email address.' }

  const token = randomBytes(32).toString('hex')
  const { error } = await d.supabase.rpc('add_company_admin', { p_company: d.company.id, p_type: input.type, p_id: newId('inv_'), p_email: email, p_token: token })
  if (error) return { kind: 'invalid', error: error.message }

  const url = `${d.origin}/register/company?token=${token}`
  const sent = await d
    .send({
      to: email,
      subject: `You have been invited to administer ${d.company.name}`,
      html: `<p>You have been invited to administer <strong>${d.company.name.replace(/[&<>"]/g, '')}</strong> on the Contractor Orientation platform.</p><p><a href="${url}">Accept the invitation</a></p><p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>`,
      text: `You have been invited to administer ${d.company.name} on the Contractor Orientation platform.\n\nAccept: ${url}\n\nThis link expires in 7 days.`,
    })
    .catch(() => false)
  return { kind: 'invited', invite: sent ? null : { token, email } }
}
