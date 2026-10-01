// An org defines a contractor company and nominates its admin (M2.5 F1b). The rules live in the database (migration
// 0019); this reads the form, asks the database in the right order, and sends the emails. It imports nothing from Next,
// so a plain node test can drive it against a real database.

import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { newId } from '../../db/utils.ts'

export type AdminType = 'in_house' | 'external' | 'third_party'
export const ADMIN_TYPES: readonly AdminType[] = ['in_house', 'external', 'third_party']

export interface DefineInput {
  legalName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  tradeTypes: string[]
  admin: { type: AdminType; userId: string; email: string }
  /** '' (first look), 'anyway' (create although a match exists) or 'link:<company id>'. */
  decision: string
}

export type Parsed = { ok: true; input: DefineInput } | { ok: false; error: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The form's fields, checked for shape only: the database decides what is allowed. */
export function parseDefineForm(f: Record<string, string | undefined>): Parsed {
  const text = (k: string) => (f[k] ?? '').trim()
  const legalName = text('legal_name')
  if (!legalName) return { ok: false, error: 'Company name is required.' }
  if (legalName.length > 200) return { ok: false, error: 'Company name is too long.' }
  const contactEmail = text('contact_email').toLowerCase()
  if (contactEmail && !EMAIL.test(contactEmail)) return { ok: false, error: 'Contact email is not an email address.' }
  const decision = text('decision')
  if (decision !== '' && decision !== 'anyway' && !/^link:cco_[0-9A-Z]{26}$/.test(decision)) return { ok: false, error: 'Unknown choice.' }
  const type = text('admin_type') as AdminType
  const admin = { type, userId: text('admin_user_id'), email: text('admin_email').toLowerCase() }
  // Linking to a company someone else defined needs no admin of ours; creating one does.
  if (!decision.startsWith('link:')) {
    if (!ADMIN_TYPES.includes(type)) return { ok: false, error: 'Choose who will administer this company.' }
    if (type === 'in_house' && !admin.userId) return { ok: false, error: 'Choose a member of your organization.' }
    if (type !== 'in_house' && !EMAIL.test(admin.email)) return { ok: false, error: 'Enter the admin’s email address.' }
  }
  const tradeTypes = text('trade_types').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 30)
  return { ok: true, input: { legalName, contactName: text('contact_name'), contactEmail, contactPhone: text('contact_phone'), tradeTypes, admin, decision } }
}

export interface Match {
  id: string
  name: string
  alreadyLinked: boolean
}

export type DefineResult =
  | { kind: 'invalid'; error: string }
  | { kind: 'matches'; matches: Match[] }
  | { kind: 'created'; companyId: string; invite: { token: string; email: string } | null; warning: string | null }
  | { kind: 'linked'; companyId: string; notified: number }

export interface Mail {
  to: string
  subject: string
  html: string
  text: string
}

export interface Deps {
  /** The signed-in person's client: every call runs as them, so the database's own checks apply. */
  supabase: SupabaseClient
  /** Service role: used only to find the admins of an existing company to tell them. */
  admin: SupabaseClient
  org: { id: string; name: string }
  /** Sends one email; returns whether it went (no key configured is "not sent"). */
  send: (mail: Mail) => Promise<boolean>
  /** Where the app lives, for links in email: https://host */
  origin: string
}

const refusal = (e: { message: string }) => e.message

export async function defineCompany(d: Deps, input: DefineInput): Promise<DefineResult> {
  const { supabase, org } = d
  const link = input.decision.startsWith('link:') ? input.decision.slice(5) : null

  if (input.decision === '') {
    const { data, error } = await supabase.rpc('match_contractor_companies', { p_org: org.id, p_name: input.legalName, p_contact_email: input.contactEmail || null })
    if (error) return { kind: 'invalid', error: refusal(error) }
    const matches = ((data ?? []) as { company_id: string; legal_name: string; already_linked: boolean }[]).map((m) => ({ id: m.company_id, name: m.legal_name, alreadyLinked: m.already_linked }))
    if (matches.length > 0) return { kind: 'matches', matches }
  }

  const { data: made, error } = await supabase.rpc('define_contractor_company', {
    p_org: org.id,
    p_company_id: newId('cco_'),
    p_link_id: newId('ccl_'),
    p_legal_name: input.legalName,
    p_contact_name: input.contactName || null,
    p_contact_email: input.contactEmail || null,
    p_contact_phone: input.contactPhone || null,
    p_trade_types: input.tradeTypes,
    p_link_existing: link,
    p_create_anyway: input.decision === 'anyway',
  })
  if (error) return { kind: 'invalid', error: refusal(error) }
  const row = ((made ?? []) as { company_id: string; linked_existing: boolean }[])[0]
  if (!row) return { kind: 'invalid', error: 'The company could not be saved.' }

  if (row.linked_existing) return { kind: 'linked', companyId: row.company_id, notified: await tellCompanyAdmins(d, row.company_id, input.legalName) }

  // The company exists now; if naming its admin fails, say so and leave it for the company page rather than undo it.
  const token = input.admin.type === 'in_house' ? null : randomBytes(32).toString('hex')
  const { error: nErr } = await supabase.rpc('nominate_company_admin', {
    p_org: org.id,
    p_company: row.company_id,
    p_type: input.admin.type,
    p_id: newId(input.admin.type === 'in_house' ? 'mem_' : 'inv_'),
    p_user_id: input.admin.type === 'in_house' ? input.admin.userId : null,
    p_email: input.admin.type === 'in_house' ? null : input.admin.email,
    p_token: token,
  })
  if (nErr) return { kind: 'created', companyId: row.company_id, invite: null, warning: `The company was added, but its admin could not be nominated: ${refusal(nErr)}` }

  if (!token) return { kind: 'created', companyId: row.company_id, invite: null, warning: null }
  const url = `${d.origin}/register/company?token=${token}`
  const sent = await d.send({
    to: input.admin.email,
    subject: `${org.name} has set up ${input.legalName} on the Contractor Orientation platform`,
    html: `<p>${esc(org.name)} has added <strong>${esc(input.legalName)}</strong> and nominated you as its administrator.</p><p><a href="${url}">Accept and set up the company</a></p><p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>`,
    text: `${org.name} has added ${input.legalName} and nominated you as its administrator.\n\nAccept: ${url}\n\nThis link expires in 7 days.`,
  }).catch(() => false)
  return { kind: 'created', companyId: row.company_id, invite: sent ? null : { token, email: input.admin.email }, warning: null }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Emails each admin of a company an org has asked to link to. Never throws: the link is made either way. */
async function tellCompanyAdmins(d: Deps, companyId: string, name: string): Promise<number> {
  try {
    const { data } = await d.admin.from('company_memberships').select('users(primary_email)').eq('company_id', companyId).eq('status', 'active').contains('roles', ['contractor_admin'])
    const emails = [...new Set(((data ?? []) as unknown as { users: { primary_email: string } | null }[]).map((r) => r.users?.primary_email).filter((e): e is string => !!e))]
    let sent = 0
    for (const to of emails) {
      const ok = await d.send({
        to,
        subject: `${d.org.name} would like to work with ${name}`,
        html: `<p><strong>${esc(d.org.name)}</strong> has asked to link to <strong>${esc(name)}</strong> on the Contractor Orientation platform.</p><p><a href="${d.origin}/company">Review the request in your company portal</a></p>`,
        text: `${d.org.name} has asked to link to ${name} on the Contractor Orientation platform.\n\nReview the request: ${d.origin}/company`,
      }).catch(() => false)
      if (ok) sent += 1
    }
    return sent
  } catch {
    return 0
  }
}
