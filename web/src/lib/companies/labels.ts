// Contractor-company labels and RPC error messages (F1). No imports on purpose:
// shared by server actions, client components and node:test.

export type AdminType = 'company_staff' | 'client_staff' | 'third_party'

export const ADMIN_TYPES: { value: AdminType; label: string; hint: string }[] = [
  { value: 'company_staff', label: 'Company staff', hint: 'Someone who works for the contractor company' },
  { value: 'client_staff', label: 'Our staff (in-house)', hint: 'Someone from your organization' },
  { value: 'third_party', label: 'Third-party administrator', hint: 'An outside agency or person; may run several companies' },
]

export const ADMIN_TYPE_LABEL: Record<AdminType, string> = {
  company_staff: 'Company staff',
  client_staff: 'Our staff (in-house)',
  third_party: 'Third-party administrator',
}

export function isAdminType(v: unknown): v is AdminType {
  return v === 'company_staff' || v === 'client_staff' || v === 'third_party'
}

export type LinkStatus = 'invited' | 'active' | 'suspended' | 'declined'

/**
 * How an org-company link reads to the org. An `invited` link means either
 * "we created it and our nominated admin hasn't accepted yet" or "we asked to
 * link to an existing company and it hasn't answered yet".
 */
export function linkStatusLabel(status: LinkStatus, createdByUs: boolean): string {
  switch (status) {
    case 'active':
      return 'Linked'
    case 'invited':
      return createdByUs ? 'Awaiting admin' : 'Requested'
    case 'declined':
      return 'Declined'
    case 'suspended':
      return 'Suspended'
  }
}

// Stable error codes raised by the F1 RPCs (migration 0018) → user-facing text.
const RPC_ERROR_MESSAGES: Record<string, string> = {
  not_client_admin: 'Only a Client Admin of this organization can do that.',
  name_required: 'Enter the company name.',
  admin_email_required: "Enter the admin's email address.",
  admin_type_required: 'Choose the admin type.',
  duplicate_business_number:
    'A company with this business number is already on the platform — search for it and request a link instead.',
  possible_duplicate:
    'A company with this name is already on the platform. Request a link to it from the search results, or confirm this is a different company.',
  company_not_found: 'That company no longer exists.',
  already_linked: 'You are already linked to this company.',
  not_creator: 'Only the organization that created this company can change its admin nomination.',
  company_has_admin: 'This company already has an admin — its admins now manage admins.',
}

export function companyErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? ''
  const code = Object.keys(RPC_ERROR_MESSAGES).find((k) => text.includes(k))
  return code ? RPC_ERROR_MESSAGES[code] : 'Something went wrong. Please try again.'
}

export function isPossibleDuplicate(raw: string | null | undefined): boolean {
  return (raw ?? '').includes('possible_duplicate')
}
