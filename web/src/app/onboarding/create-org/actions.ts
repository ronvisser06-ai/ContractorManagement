'use server'

import { createClient } from '@/lib/supabase/server'
import { newId } from '@/db/utils'
import { redirect } from 'next/navigation'

export async function createOrg(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const name = (formData.get('name') as string | null)?.trim() ?? ''
  if (!name) redirect('/onboarding/create-org?error=Organization+name+is+required')

  // IDs generated in the app layer so ULID format is consistent project-wide
  const orgId = newId('org_')
  const membershipId = newId('mem_')

  const { error } = await supabase.rpc('create_organization', {
    p_org_id: orgId,
    p_org_name: name,
    p_membership_id: membershipId,
  })

  if (error) {
    redirect(
      `/onboarding/create-org?error=${encodeURIComponent(error.message)}`,
    )
  }

  redirect('/app')
}
