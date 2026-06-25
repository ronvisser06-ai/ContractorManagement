'use server'

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { newId } from '@/db/utils'

async function requireContractorAdmin() {
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
    redirect('/company/workers?error=Only+a+Contractor+Admin+can+manage+workers')
  }

  return { supabase, user, companyId: membership.company_id as string }
}

export async function addWorker(formData: FormData) {
  const { supabase, companyId } = await requireContractorAdmin()

  const givenName = ((formData.get('given_name') as string | null) ?? '').trim()
  const familyName = ((formData.get('family_name') as string | null) ?? '').trim()
  const email = ((formData.get('email') as string | null) ?? '').trim().toLowerCase()
  const mobile = ((formData.get('mobile') as string | null) ?? '').trim()

  const errBase = '/company/workers?error='
  if (!givenName || !familyName) redirect(`${errBase}${encodeURIComponent('First and last name are required')}`)
  if (!email) redirect(`${errBase}${encodeURIComponent('Email is required')}`)

  // Reject duplicate within this company by invited_email (fast, RLS-covered).
  const { data: dup } = await supabase
    .from('company_memberships')
    .select('id')
    .eq('company_id', companyId)
    .eq('invited_email', email)
    .eq('status', 'active')
    .maybeSingle()
  if (dup) {
    redirect(`${errBase}${encodeURIComponent('A worker with this email is already in your roster')}`)
  }

  const admin = createAdminClient()

  // Create a provisional auth user (no password — they'll set one when they open the
  // invite link in Step 4b). email_confirm: true so the handle_new_user trigger
  // fires and creates the public.users row synchronously.
  let workerId: string
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { given_name: givenName, family_name: familyName },
  })

  if (authErr) {
    if (authErr.message?.toLowerCase().includes('already')) {
      // A user with this email exists — link to them directly.
      // Soft-match UX (Step 4b) handles the worker-facing flow.
      const { data: existing } = await admin
        .from('users')
        .select('id')
        .eq('primary_email', email)
        .maybeSingle()
      if (!existing) {
        redirect(`${errBase}${encodeURIComponent('Could not locate existing user account')}`)
      }
      workerId = existing.id as string
    } else {
      redirect(`${errBase}${encodeURIComponent(authErr.message)}`)
    }
  } else {
    workerId = authData.user.id
    // The trigger doesn't capture mobile — update the profile row directly.
    if (mobile) {
      await admin
        .from('users')
        .update({ mobile, updated_at: new Date().toISOString() })
        .eq('id', workerId)
    }
  }

  // Insert the worker membership. RLS "company_memberships: insert if contractor_admin"
  // enforces that the caller owns this company_id.
  const { error: memErr } = await supabase.from('company_memberships').insert({
    id: newId('mem_'),
    user_id: workerId,
    company_id: companyId,
    roles: ['worker'],
    onboarding_status: 'entered',
    invited_email: email,
    status: 'active',
  })

  if (memErr) {
    redirect(`${errBase}${encodeURIComponent(memErr.message)}`)
  }

  redirect('/company/workers?added=1')
}

export async function inviteWorker(formData: FormData) {
  const { supabase, user, companyId } = await requireContractorAdmin()

  const membershipId = ((formData.get('membership_id') as string | null) ?? '').trim()
  if (!membershipId) redirect('/company/workers?error=Missing+membership+ID')

  // Fetch the target membership — the eq(company_id) ensures we only touch our company.
  const { data: targetMembership } = await supabase
    .from('company_memberships')
    .select('id, onboarding_status, invited_email')
    .eq('id', membershipId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle()

  if (!targetMembership) {
    redirect('/company/workers?error=Worker+not+found')
  }
  if (targetMembership.onboarding_status !== 'entered') {
    redirect('/company/workers?error=This+worker+has+already+been+invited+or+has+registered')
  }

  const workerEmail = targetMembership.invited_email as string | null
  if (!workerEmail) {
    redirect('/company/workers?error=No+email+on+record+for+this+worker')
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // Insert invitation. RLS "invitations: insert if admin" permits contractor_admin
  // when company_id is set and belongs to their company.
  const { error: invErr } = await supabase.from('invitations').insert({
    id: newId('inv_'),
    type: 'worker',
    token,
    channel: 'email',
    email: workerEmail,
    company_id: companyId,
    intended_roles: ['worker'],
    status: 'pending',
    expires_at: expiresAt,
    created_by: user.id,
  })

  if (invErr) {
    redirect(`/company/workers?error=${encodeURIComponent(invErr.message)}`)
  }

  // Advance the lifecycle. RLS "company_memberships: update if contractor_admin" permits this.
  await supabase
    .from('company_memberships')
    .update({ onboarding_status: 'invited', updated_at: new Date().toISOString() })
    .eq('id', membershipId)
    .eq('company_id', companyId)

  // Dev-mode delivery — Step 7 (Resend) replaces this with a real email.
  console.log(`[DEV] Worker invite for ${workerEmail}: /register/worker?token=${token}`)

  redirect(`/company/workers?invited_token=${token}`)
}
