// What a contractor company does, as ConTrak tells Relatrix (Relatrix-Integration-Brief.md, slice S5). Pure, so it is tested
// without a database. Company-level only: the company's name (and the domain of its work address) to find it, and its
// capabilities. Never a person.

import type { CapabilitiesPayload } from './ops.ts'
import { domainFromEmail } from './links.ts'

export interface CapabilityFacts {
  companyId: string
  legalName: string
  contactEmail: string | null
  /** Catalog entries held (code and label) and the company's own names. */
  held: { code: string | null; label: string }[]
}

export function capabilitiesPayload(f: CapabilityFacts): CapabilitiesPayload {
  const domain = domainFromEmail(f.contactEmail)
  const seen = new Set<string>()
  const capabilities = f.held
    .map((h) => ({ ...(h.code ? { code: h.code } : {}), label: h.label.trim() }))
    .filter((h) => {
      const key = h.code ?? `x:${h.label.toLowerCase()}`
      if (!h.label || seen.has(key)) return false
      seen.add(key)
      return true
    })
    // Catalog entries first by code, then the company's own words: the same facts always give the same payload.
    .sort((a, b) => Number(a.code === undefined) - Number(b.code === undefined) || (a.code ?? a.label.toLowerCase()).localeCompare(b.code ?? b.label.toLowerCase()))
  return { contrak_company_id: f.companyId, name: f.legalName.trim(), ...(domain ? { domain } : {}), capabilities }
}
