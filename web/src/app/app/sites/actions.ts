'use server'

import { createClient } from '@/lib/supabase/server'
import { newId } from '@/db/utils'
import { redirect } from 'next/navigation'

export async function createSite(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Org comes from the caller's own active membership — never trust a client-submitted org_id.
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership) redirect('/onboarding/create-org')

  const name = (formData.get('name') as string | null)?.trim() ?? ''
  if (!name) redirect('/app/sites?error=Site+name+is+required')

  // RLS ("sites: write if client_admin") enforces that only a client_admin
  // of this org_id may actually insert; a non-admin gets a policy violation here.
  const { error } = await supabase.from('sites').insert({
    id: newId('site_'),
    org_id: membership.org_id,
    name,
  })

  if (error) {
    redirect(`/app/sites?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/app/sites')
}
