// Where a client organization is in its life with ConTrak, as the wanted state to send Relatrix
// (Relatrix-Integration-Brief.md D-2): org created, first site added, first orientation package published, first contractor invited.
//
// The payload is RECOMPUTED from the database each time, not accumulated, so queueing is idempotent and a milestone can
// never be lost to two events landing together. Dates are when each milestone was FIRST reached.

import type { OrgCustomerPayload } from './ops.ts'

export interface OrgFacts {
  id: string
  name: string
  createdAt: string
}

export interface OrgDates {
  firstSite: string | null
  firstPackage: string | null
  firstContractorInvite: string | null
}

export function orgLifecyclePayload(org: OrgFacts, dates: OrgDates): OrgCustomerPayload {
  const iso = (v: string) => new Date(v).toISOString()
  return {
    contrak_org_id: org.id,
    name: org.name,
    milestones: {
      signed_up: iso(org.createdAt),
      ...(dates.firstSite ? { onboarding: iso(dates.firstSite) } : {}),
      ...(dates.firstPackage ? { live: iso(dates.firstPackage) } : {}),
      ...(dates.firstContractorInvite ? { adopting: iso(dates.firstContractorInvite) } : {}),
    },
  }
}
