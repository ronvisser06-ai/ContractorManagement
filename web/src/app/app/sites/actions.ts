'use server'

import { createClient } from '@/lib/supabase/server'
import { newId } from '@/db/utils'
import { redirect } from 'next/navigation'
import { requireActiveOrg } from '@/lib/context/server'
import { queueOrgLifecycle } from '@/lib/relatrix/queue'

export async function createSite(formData: FormData) {
  // Org comes from the caller's *active* membership (F0) — never trust a client-submitted org_id.
  const { supabase, org } = await requireActiveOrg()

  const name = (formData.get('name') as string | null)?.trim() ?? ''
  if (!name) redirect('/app/sites?error=Site+name+is+required')

  // RLS ("sites: write if client_admin") enforces that only a client_admin
  // of this org_id may actually insert; a non-admin gets a policy violation here.
  const { error } = await supabase.from('sites').insert({
    id: newId('site_'),
    org_id: org.id,
    name,
  })

  if (error) {
    redirect(`/app/sites?error=${encodeURIComponent(error.message)}`)
  }

  // A first site moves the customer to Onboarding in Relatrix. Never fails the action.
  await queueOrgLifecycle(org.id)

  redirect('/app/sites')
}

export async function assignCompany(formData: FormData) {
  // Acts on the user's *active* org, with their roles in that org (F0).
  const { supabase, org, hasRole } = await requireActiveOrg()
  if (!hasRole('client_admin')) {
    redirect('/app/sites?error=Only+a+Client+Admin+can+assign+companies')
  }

  const siteId = ((formData.get('site_id') as string | null) ?? '').trim()
  const companyId = ((formData.get('company_id') as string | null) ?? '').trim()
  if (!siteId || !companyId) redirect('/app/sites?error=Missing+site+or+company')

  // Business logic: company must have an active link to this org before it can
  // be assigned to any of its sites. RLS alone only enforces site→org ownership.
  const { data: link } = await supabase
    .from('client_company_links')
    .select('id')
    .eq('org_id', org.id)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle()
  if (!link) redirect('/app/sites?error=This+company+is+not+linked+to+your+organization')

  // Re-activate an existing removed assignment rather than inserting a duplicate.
  const { data: existing } = await supabase
    .from('site_company_assignments')
    .select('id')
    .eq('site_id', siteId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('site_company_assignments')
      .update({ status: 'active', assigned_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) redirect(`/app/sites?error=${encodeURIComponent(error.message)}`)
  } else {
    const { error } = await supabase.from('site_company_assignments').insert({
      id: newId('sca_'),
      site_id: siteId,
      company_id: companyId,
      status: 'active',
    })
    if (error) redirect(`/app/sites?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/app/sites')
}

export async function removeAssignment(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const assignmentId = ((formData.get('assignment_id') as string | null) ?? '').trim()
  if (!assignmentId) redirect('/app/sites?error=Missing+assignment+id')

  // RLS "site_company_asgn: write if client_admin" enforces the org ownership check.
  const { error } = await supabase
    .from('site_company_assignments')
    .update({ status: 'removed' })
    .eq('id', assignmentId)
  if (error) redirect(`/app/sites?error=${encodeURIComponent(error.message)}`)

  redirect('/app/sites')
}
