'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { requireActiveOrg } from '@/lib/context/server'
import { queueCompanyLinks, queueOrgLifecycle } from '@/lib/relatrix/queue'
import { defineCompany, parseDefineForm, type Match } from '@/lib/companies/define'

export interface FormState {
  error?: string
  matches?: Match[]
  /** What was typed, handed back because React clears an uncontrolled form after every action. */
  values?: Record<string, string>
}

export async function defineCompanyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, org, hasRole } = await requireActiveOrg()
  const values: Record<string, string> = {}
  for (const [k, v] of formData.entries()) if (typeof v === 'string' && k !== 'decision' && !k.startsWith('$')) values[k] = v
  if (!hasRole('client_admin')) return { error: 'Only a Client Admin can add a contractor company.', values }

  const parsed = parseDefineForm(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>)
  if (!parsed.ok) return { error: parsed.error, values }

  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'

  const result = await defineCompany(
    {
      supabase,
      admin: createAdminClient(),
      org: { id: org.id, name: org.name },
      send: async (mail) => (await sendEmail(mail)).sent,
      origin: `${proto}://${host}`,
    },
    parsed.input,
  )

  if (result.kind === 'invalid') return { error: result.error, values }
  if (result.kind === 'matches') return { matches: result.matches, values }

  await queueOrgLifecycle(org.id)
  await queueCompanyLinks(result.companyId)
  if (result.kind === 'linked') redirect(`/app/contractors?linked=${result.notified > 0 ? 'told' : 'asked'}`)
  if (result.warning) redirect(`/app/contractors?error=${encodeURIComponent(result.warning)}`)
  if (result.invite) redirect(`/app/contractors?invite_token=${result.invite.token}`)
  redirect('/app/contractors?defined=1')
}
