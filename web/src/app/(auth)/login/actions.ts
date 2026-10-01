'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { safeNextPath } from '@/lib/http/safe-next'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const next = safeNextPath(formData.get('next'))

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) {
    const qs = new URLSearchParams({ error: error.message })
    if (next) qs.set('next', next)
    redirect(`/login?${qs.toString()}`)
  }

  // Back to where they came from (e.g. an invitation), else the landing router.
  redirect(next ?? '/')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
