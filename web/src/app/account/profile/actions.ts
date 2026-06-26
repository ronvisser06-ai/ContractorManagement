'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ulid } from 'ulid'

function newId(prefix: string) {
  return `${prefix}${ulid()}`
}

export async function requestEmailVerification(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const rawEmail = (formData.get('email') as string | null)?.trim().toLowerCase()
  if (!rawEmail) redirect('/account/profile?error=Email+is+required')

  // Reject if the user is adding their own auth primary email.
  const { data: profile } = await supabase
    .from('users')
    .select('primary_email')
    .eq('id', user.id)
    .single()

  if (profile?.primary_email?.toLowerCase() === rawEmail) {
    redirect('/account/profile?error=This+is+already+your+primary+email+address')
  }

  // Early uniqueness check (the RPC re-checks atomically at verification time).
  const { data: existing } = await supabase
    .from('user_emails')
    .select('user_id')
    .eq('email', rawEmail)
    .maybeSingle()

  if (existing) {
    if (existing.user_id === user.id) {
      redirect('/account/profile?error=This+email+is+already+on+your+account')
    } else {
      redirect('/account/profile?error=This+email+is+already+verified+to+another+account')
    }
  }

  // Generate a 64-char hex token (32 random bytes).
  const tokenBytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(tokenBytes)
  const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, '0')).join('')

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from('email_verifications').insert({
    id: newId('evf_'),
    user_id: user.id,
    email: rawEmail,
    token,
    status: 'pending',
    expires_at: expiresAt,
  })

  if (error) {
    redirect(`/account/profile?error=${encodeURIComponent(error.message)}`)
  }

  redirect(
    `/account/profile?verify_token=${encodeURIComponent(token)}&verify_email=${encodeURIComponent(rawEmail)}`,
  )
}
