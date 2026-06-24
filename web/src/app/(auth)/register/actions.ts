'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function register(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const given_name = formData.get('given_name') as string
  const family_name = formData.get('family_name') as string

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // The handle_new_user trigger reads these from raw_user_meta_data
      data: { given_name, family_name },
    },
  })

  if (error) {
    redirect(`/register?error=${encodeURIComponent(error.message)}`)
  }

  // Email confirmation is enabled → no session yet
  if (!data.session) {
    redirect('/register?confirm=1')
  }

  redirect('/app')
}
