'use server'

import { createClient } from '@/lib/supabase/server'
import { newId } from '@/db/utils'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'

async function requireContractorAdmin(): Promise<{
  supabase: SupabaseClient
  userId: string
  companyId: string
}> {
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
  if (!(membership.roles as string[]).includes('contractor_admin')) {
    redirect('/company/crew?error=Only+a+Contractor+Admin+can+manage+crew')
  }

  return { supabase, userId: user.id, companyId: membership.company_id as string }
}

export async function activateWorker(formData: FormData) {
  const { supabase, userId, companyId } = await requireContractorAdmin()

  const siteId = ((formData.get('site_id') as string | null) ?? '').trim()
  const workerUserId = ((formData.get('worker_user_id') as string | null) ?? '').trim()
  if (!siteId || !workerUserId) redirect('/company/crew?error=Missing+site+or+worker')

  // Business logic: company must be actively assigned to this site.
  // RLS only checks that company_id belongs to the caller — the site eligibility
  // check must be explicit to match the spec invariant.
  const { data: assignment } = await supabase
    .from('site_company_assignments')
    .select('id')
    .eq('site_id', siteId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle()
  if (!assignment) redirect('/company/crew?error=Your+company+is+not+assigned+to+this+site')

  // Business logic: worker must be an active member of this company.
  const { data: workerMembership } = await supabase
    .from('company_memberships')
    .select('id')
    .eq('company_id', companyId)
    .eq('user_id', workerUserId)
    .eq('status', 'active')
    .maybeSingle()
  if (!workerMembership) redirect('/company/crew?error=Worker+is+not+a+member+of+your+company')

  // Re-activate an existing removed activation; otherwise insert fresh.
  const { data: existing } = await supabase
    .from('site_worker_activations')
    .select('id')
    .eq('site_id', siteId)
    .eq('user_id', workerUserId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('site_worker_activations')
      .update({
        status: 'active',
        activated_by: userId,
        activated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (error) redirect(`/company/crew?error=${encodeURIComponent(error.message)}`)
  } else {
    const { error } = await supabase.from('site_worker_activations').insert({
      id: newId('swa_'),
      site_id: siteId,
      company_id: companyId,
      user_id: workerUserId,
      status: 'active',
      activated_by: userId,
    })
    if (error) redirect(`/company/crew?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/company/crew')
}

export async function deactivateWorker(formData: FormData) {
  const { supabase, companyId } = await requireContractorAdmin()

  const activationId = ((formData.get('activation_id') as string | null) ?? '').trim()
  if (!activationId) redirect('/company/crew?error=Missing+activation+id')

  // The .eq('company_id', companyId) guard here is defence-in-depth alongside
  // RLS "site_worker_act: write if contractor_admin".
  const { error } = await supabase
    .from('site_worker_activations')
    .update({ status: 'removed' })
    .eq('id', activationId)
    .eq('company_id', companyId)
  if (error) redirect(`/company/crew?error=${encodeURIComponent(error.message)}`)

  redirect('/company/crew')
}
