// The wanted state of one client → contractor link, from ConTrak's facts (Relatrix-Integration-Brief.md S4). Pure, so it
// is tested without a database. What crosses is company-level only: both companies' names, the contractor's website
// domain when it can be told, and the link's status. Never a contact, an email address, a worker or a site.

/** Mailbox providers: an address at one says nothing about the company's own website. */
const MAILBOX_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.ca', 'icloud.com', 'me.com',
  'aol.com', 'proton.me', 'protonmail.com', 'shaw.ca', 'telus.net', 'rogers.com', 'bell.net', 'sympatico.ca', 'videotron.ca', 'eastlink.ca',
])

/** The website domain a contact address implies, or null when it is a mailbox provider or not an address. Only the domain leaves. */
export function domainFromEmail(email: string | null | undefined): string | null {
  const at = (email ?? '').trim().toLowerCase().split('@')
  if (at.length !== 2 || !at[1]) return null
  const domain = at[1]
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return null
  return MAILBOX_PROVIDERS.has(domain) ? null : domain
}

import type { LinkUsesPayload } from './ops.ts'

export type LinkStatus = 'invited' | 'active' | 'suspended'

export interface LinkFacts {
  linkId: string
  status: LinkStatus
  /** When the link became active, if it has. */
  acceptedAt: string | null
  org: { id: string; name: string }
  company: { id: string; legalName: string; contactEmail: string | null }
}

export function linkPayload(f: LinkFacts): LinkUsesPayload {
  const domain = domainFromEmail(f.company.contactEmail)
  const since = f.acceptedAt && !Number.isNaN(Date.parse(f.acceptedAt)) ? new Date(f.acceptedAt).toISOString().slice(0, 10) : null
  return {
    contrak_link_id: f.linkId,
    status: f.status,
    ...(since && f.status === 'active' ? { since } : {}),
    org: { id: f.org.id, name: f.org.name.trim() },
    company: { id: f.company.id, name: f.company.legalName.trim(), ...(domain ? { domain } : {}) },
  }
}
