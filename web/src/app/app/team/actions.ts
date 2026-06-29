'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { orgRoleEnum } from '@/db/schema'

type OrgRole = (typeof orgRoleEnum.enumValues)[number]

const TOGGLEABLE_ROLES = new Set<OrgRole>([
  'client_admin',
  'content_developer',
  'content_approver',
  'foreman',
])

export async function toggleRole(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const membershipId = formData.get('membership_id') as string | null
  const role = formData.get('role') as string | null
  const action = formData.get('action') as string | null

  if (!membershipId || !role || (action !== 'grant' && action !== 'revoke')) {
    redirect('/app/team?error=Invalid+request')
  }
  if (!TOGGLEABLE_ROLES.has(role as OrgRole)) {
    redirect('/app/team?error=Invalid+role')
  }

  // Caller's membership — must be client_admin in an active org
  const { data: callerMembership } = await supabase
    .from('org_memberships')
    .select('org_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!callerMembership) redirect('/app/team?error=Not+an+org+member')

  const callerRoles = (callerMembership.roles as OrgRole[] | undefined) ?? []
  if (!callerRoles.includes('client_admin')) {
    redirect('/app/team?error=Only+a+client+admin+can+manage+roles')
  }

  // Target membership — must be active and in the same org (RLS also enforces this)
  const { data: target } = await supabase
    .from('org_memberships')
    .select('id, org_id, roles, status')
    .eq('id', membershipId)
    .maybeSingle()

  if (!target || target.org_id !== callerMembership.org_id || target.status !== 'active') {
    redirect('/app/team?error=Member+not+found')
  }

  const currentRoles = (target.roles as OrgRole[] | undefined) ?? []
  const hasRole = currentRoles.includes(role as OrgRole)

  // No-op guard — skip the write when the state already matches
  if ((action === 'grant' && hasRole) || (action === 'revoke' && !hasRole)) {
    redirect('/app/team')
  }

  // Last-admin guard: never allow the org to have zero client_admins.
  // Checked before the write because USING in the UPDATE policy evaluates
  // with the pre-update roles, so the DB would permit this write.
  if (role === 'client_admin' && action === 'revoke') {
    const { data: allActive } = await supabase
      .from('org_memberships')
      .select('roles')
      .eq('org_id', callerMembership.org_id)
      .eq('status', 'active')

    const adminCount = (allActive ?? []).filter((m) =>
      ((m.roles as OrgRole[] | undefined) ?? []).includes('client_admin'),
    ).length

    if (adminCount <= 1) {
      redirect('/app/team?error=Cannot+remove+the+last+client+admin+from+the+org')
    }
  }

  const newRoles: OrgRole[] =
    action === 'grant'
      ? Array.from(new Set([...currentRoles, role as OrgRole]))
      : currentRoles.filter((r) => r !== role)

  const { error } = await supabase
    .from('org_memberships')
    .update({ roles: newRoles })
    .eq('id', membershipId)

  if (error) {
    redirect(`/app/team?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/app/team')
}
