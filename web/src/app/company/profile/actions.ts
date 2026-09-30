'use server'

import { redirect } from 'next/navigation'
import { requireActiveCompany } from '@/lib/context/server'

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

  // trade_types: comma-separated text → text[]
  const tradeTypesRaw = ((formData.get('trade_types') as string | null) ?? '').trim()
  const tradeTypes = tradeTypesRaw
    ? tradeTypesRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : []

  // RLS ("contractor_companies: update if contractor_admin") enforces that only
  // a contractor_admin of this company_id may write.
  const { error } = await supabase
    .from('contractor_companies')
    .update({
      legal_name: legalName,
      contact_name: contactName || null,
      contact_phone: contactPhone || null,
      trade_types: tradeTypes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', company.id)

  if (error) {
    redirect(`/company/profile?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/company/profile?saved=1')
}
