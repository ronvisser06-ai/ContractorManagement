'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function confirmEmailVerification(formData: FormData) {
  const token = (formData.get('token') as string | null)?.trim()
  if (!token) redirect('/account/profile?error=Missing+verification+token')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.rpc('verify_and_link_email', { p_token: token })

  if (error) {
    // The RPC raises exceptions with a plain message (e.g. "email_taken").
    // Pass it back to the page for display.
    const code = error.message.trim()
    redirect(
      `/account/verify-email?token=${encodeURIComponent(token)}&rpc_error=${encodeURIComponent(code)}`,
    )
  }

  redirect('/account/profile?verified=1')
}
