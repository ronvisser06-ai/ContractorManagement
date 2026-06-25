'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function updateCompanyProfile(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('company_memberships')
    .select('company_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) redirect('/login')

  const roles = membership.roles as string[]
  if (!roles.includes('contractor_admin')) {
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
    .eq('id', membership.company_id)

  if (error) {
    redirect(`/company/profile?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/company/profile?saved=1')
}
