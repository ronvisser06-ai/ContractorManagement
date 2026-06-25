'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { newId } from '@/db/utils'

// Claim a worker invite: set a password on the provisional auth user, create the
// user_emails identity row, advance onboarding lifecycle, sign the worker in.
// Also handles the soft-match detection (redirect to "is this you?" prompt) and
// the bypass path (user confirmed they are a new identity after seeing the prompt).
export async function claimWorkerInvite(formData: FormData) {
  const token = ((formData.get('token') as string | null) ?? '').trim()
  const givenName = ((formData.get('given_name') as string | null) ?? '').trim()
  const familyName = ((formData.get('family_name') as string | null) ?? '').trim()
  const mobile = ((formData.get('mobile') as string | null) ?? '').trim()
  const password = ((formData.get('password') as string | null) ?? '').trim()
  const bypassSoftMatch = formData.get('bypass_soft_match') === '1'

  const tokenParam = `token=${encodeURIComponent(token)}`
  const base = `/register/worker?${tokenParam}`
  const errBase = `${base}&error=`

  if (!token) redirect(`/register/worker?error=${encodeURIComponent('Invalid invite link')}`)
  if (!givenName || !familyName)
    redirect(`${errBase}${encodeURIComponent('First and last name are required')}`)
  if (!password || password.length < 8)
    redirect(`${errBase}${encodeURIComponent('Password must be at least 8 characters')}`)

  const admin = createAdminClient()

  // Validate the token — full lock happens inside the RPC.
  const { data: inv } = await admin
    .from('invitations')
    .select('status, expires_at, email, company_id')
    .eq('token', token)
    .eq('type', 'worker')
    .maybeSingle()

  if (!inv) redirect(`/register/worker?error=${encodeURIComponent('Invalid invite link')}`)

  const invStatus = inv.status as string
  const invEmail = inv.email as string
  const companyId = inv.company_id as string

  if (invStatus === 'accepted')
    redirect(`/register/worker?error=${encodeURIComponent('This invite has already been used — sign in to your account')}`)
  if (invStatus !== 'pending')
    redirect(`/register/worker?error=${encodeURIComponent('This invitation has been revoked')}`)
  if (new Date(inv.expires_at as string) < new Date())
    redirect(`/register/worker?error=${encodeURIComponent('This invite link has expired — ask your company admin to send a new one')}`)

  // Locate the provisional membership created in Step 4a.
  const { data: membership } = await admin
    .from('company_memberships')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('invited_email', invEmail)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership)
    redirect(`${errBase}${encodeURIComponent('Worker record not found — contact your company admin')}`)

  const provisionalId = membership.user_id as string

  // Soft-match guard (§5 reconciliation): before claiming, check for an existing
  // distinct identity with the same mobile + name. On a probable match, redirect
  // to the "Is this you?" prompt rather than silently creating a duplicate.
  if (!bypassSoftMatch && mobile) {
    const { data: match } = await admin
      .from('users')
      .select('id, given_name, family_name')
      .eq('mobile', mobile)
      .ilike('given_name', givenName)
      .ilike('family_name', familyName)
      .neq('id', provisionalId)
      .limit(1)
      .maybeSingle()

    if (match) {
      const matchId = match.id as string
      redirect(`${base}&suggest=${matchId}`)
    }
  }

  // Claim: set the password on the provisional auth user and update the profile.
  const { error: updateErr } = await admin.auth.admin.updateUserById(provisionalId, {
    password,
    user_metadata: { given_name: givenName, family_name: familyName },
  })
  if (updateErr)
    redirect(`${errBase}${encodeURIComponent(updateErr.message)}`)

  await admin
    .from('users')
    .update({
      given_name: givenName,
      family_name: familyName,
      ...(mobile ? { mobile } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', provisionalId)

  // Insert the primary user_emails row (idempotent — skip if already present).
  const { data: existingEmailRow } = await admin
    .from('user_emails')
    .select('id')
    .eq('user_id', provisionalId)
    .eq('email', invEmail)
    .maybeSingle()

  if (!existingEmailRow) {
    await admin.from('user_emails').insert({
      id: newId('ue_'),
      user_id: provisionalId,
      email: invEmail,
      is_primary: true,
      verified_at: new Date().toISOString(),
    })
  }

  // Atomically advance lifecycle + consume token (SECURITY DEFINER RPC, FOR UPDATE lock).
  const { error: rpcErr } = await admin.rpc('claim_worker_invite', {
    p_token: token,
    p_claiming_user_id: provisionalId,
    p_provisional_user_id: provisionalId,
  })
  if (rpcErr)
    redirect(`${errBase}${encodeURIComponent(rpcErr.message)}`)

  // Sign the worker in.
  const supabase = await createClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: invEmail,
    password,
  })
  if (signInErr)
    redirect(`${errBase}${encodeURIComponent('Account created but sign-in failed — please sign in manually')}`)

  redirect('/company')
}

// Called from the "Is this you?" soft-match prompt: sign in as the existing
// identity and re-point this company's membership to it, discarding the
// provisional stub created in Step 4a.
export async function loginAndMerge(formData: FormData) {
  const token = ((formData.get('token') as string | null) ?? '').trim()
  const email = ((formData.get('email') as string | null) ?? '').trim()
  const password = ((formData.get('password') as string | null) ?? '').trim()
  const existingUserId = ((formData.get('existing_user_id') as string | null) ?? '').trim()

  const tokenParam = `token=${encodeURIComponent(token)}`
  const suggestBase = `/register/worker?${tokenParam}&suggest=${existingUserId}`
  const errBase = `${suggestBase}&merge_error=`

  if (!token || !email || !password || !existingUserId)
    redirect(`${errBase}${encodeURIComponent('Missing required fields')}`)

  // Sign in as the existing user.
  const supabase = await createClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signInErr)
    redirect(`${errBase}${encodeURIComponent('Sign-in failed — check your email and password')}`)

  // Verify the signed-in user is the expected existing identity.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.id !== existingUserId) {
    await supabase.auth.signOut()
    redirect(`${errBase}${encodeURIComponent('Signed in as a different account than expected — please try again')}`)
  }

  const admin = createAdminClient()

  // Re-validate the token and find the provisional user.
  const { data: inv } = await admin
    .from('invitations')
    .select('company_id, email, status, expires_at')
    .eq('token', token)
    .eq('type', 'worker')
    .maybeSingle()

  const tokenBase = `/register/worker?${tokenParam}`
  if (!inv || (inv.status as string) !== 'pending' || new Date(inv.expires_at as string) < new Date())
    redirect(`${tokenBase}&error=${encodeURIComponent('This invite is no longer valid')}`)

  const companyId = inv.company_id as string
  const invEmail = inv.email as string

  // Find the provisional user_id (the stub that invited this email, different from existing).
  const { data: provisionalMembership } = await admin
    .from('company_memberships')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('invited_email', invEmail)
    .neq('user_id', existingUserId)
    .eq('status', 'active')
    .maybeSingle()

  // If no separate provisional exists (edge case: admin linked existing user directly in 4a),
  // treat the existing user as both claiming and provisional.
  const provisionalId = (provisionalMembership?.user_id as string | null) ?? existingUserId

  // Atomically re-point membership + consume token.
  const { error: rpcErr } = await admin.rpc('claim_worker_invite', {
    p_token: token,
    p_claiming_user_id: existingUserId,
    p_provisional_user_id: provisionalId,
  })
  if (rpcErr)
    redirect(`${errBase}${encodeURIComponent(rpcErr.message)}`)

  // Delete the provisional auth stub — it was only ever a placeholder.
  if (provisionalId !== existingUserId) {
    await admin.auth.admin.deleteUser(provisionalId)
  }

  redirect('/company')
}
