'use server'

import { redirect } from 'next/navigation'
import { requireActiveCompany } from '@/lib/context/server'
import { queueCompanyCapabilities, queueCompanyLinks } from '@/lib/relatrix/queue'
import { readCapabilityForm } from '@/lib/companies/capabilities'

export async function updateCompanyProfile(formData: FormData) {
  // Acts on the user's *active* company, with their role in that company (F0).
  const { supabase, company, isContractorAdmin } = await requireActiveCompany()

  if (!isContractorAdmin) {
    redirect('/company/profile?error=Only+a+Contractor+Admin+can+edit+the+company+profile')
  }

  const legalName = ((formData.get('legal_name') as string | null) ?? '').trim()
  if (!legalName) redirect('/company/profile?error=Company+name+is+required')

  const contactName = ((formData.get('contact_name') as string | null) ?? '').trim()
  const contactPhone = ((formData.get('contact_phone') as string | null) ?? '').trim()

  // RLS ("contractor_companies: update if contractor_admin") enforces that only
  // a contractor_admin of this company_id may write.
  const { error } = await supabase
    .from('contractor_companies')
    .update({
      legal_name: legalName,
      contact_name: contactName || null,
      contact_phone: contactPhone || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', company.id)

  if (error) {
    redirect(`/company/profile?error=${encodeURIComponent(error.message)}`)
  }

  // What the company does: the whole list, set in one go (the database checks who may, and what is allowed).
  const { catalog, custom } = readCapabilityForm(formData)
  const { error: capError } = await supabase.rpc('set_company_capabilities', { p_company: company.id, p_catalog: catalog, p_custom: custom })
  if (capError) redirect(`/company/profile?error=${encodeURIComponent(capError.message)}`)

  // A renamed company or a new contact domain changes what Relatrix is told about every organization that uses it.
  await queueCompanyLinks(company.id)
  await queueCompanyCapabilities(company.id)
  redirect('/company/profile?saved=1')
}
