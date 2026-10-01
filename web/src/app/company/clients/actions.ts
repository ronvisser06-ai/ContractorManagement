'use server'

import { redirect } from 'next/navigation'
import { requireActiveCompany } from '@/lib/context/server'
import { companyErrorMessage } from '@/lib/companies/labels'

// F1 Step 4 — answer a client org's link request (decision F1-1: the company
// must accept before the org sees anything). respond_to_link_request checks
// that the caller is an admin of the link's company.
export async function respondToRequest(formData: FormData) {
  const { supabase, isContractorAdmin } = await requireActiveCompany()
  if (!isContractorAdmin) redirect('/company/profile')

  const linkId = ((formData.get('link_id') as string | null) ?? '').trim()
  const orgName = ((formData.get('org_name') as string | null) ?? '').trim()
  const accept = formData.get('decision') === 'accept'

  const { error } = await supabase.rpc('respond_to_link_request', { p_link_id: linkId, p_accept: accept })
  if (error) redirect(`/company/clients?error=${encodeURIComponent(companyErrorMessage(error.message))}`)

  const qs = new URLSearchParams({ [accept ? 'accepted' : 'declined']: orgName })
  redirect(`/company/clients?${qs.toString()}`)
}
