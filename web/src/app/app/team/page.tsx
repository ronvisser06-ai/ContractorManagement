import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { orgRoleEnum } from '@/db/schema'
import { toggleRole } from './actions'

type OrgRole = (typeof orgRoleEnum.enumValues)[number]

const ROLE_LABELS: Record<OrgRole, string> = {
  client_admin: 'Admin',
  content_developer: 'Content Dev',
  content_approver: 'Content Approver',
  foreman: 'Foreman',
}

const TOGGLEABLE_ROLES: OrgRole[] = [
  'client_admin',
  'content_developer',
  'content_approver',
  'foreman',
]

interface Props {
  searchParams: Promise<{ error?: string; notice?: string }>
}

export default async function TeamPage({ searchParams }: Props) {
  const { error: errorParam, notice: noticeParam } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: myMembership } = await supabase
    .from('org_memberships')
    .select('org_id, roles')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!myMembership) notFound()

  const myRoles = (myMembership.roles as OrgRole[] | undefined) ?? []
  if (!myRoles.includes('client_admin')) redirect('/app')

  // Fetch all active org members with their user profile
  const { data: memberships } = await supabase
    .from('org_memberships')
    .select('id, user_id, roles')
    .eq('org_id', myMembership.org_id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  const memberUserIds = (memberships ?? []).map((m) => m.user_id as string)

  const { data: memberUsers } = await supabase
    .from('users')
    .select('id, given_name, family_name, primary_email')
    .in('id', memberUserIds)

  const usersById = Object.fromEntries((memberUsers ?? []).map((u) => [u.id, u]))

  type MemberRow = {
    id: string
    user_id: string
    roles: OrgRole[]
    given_name: string
    family_name: string
    primary_email: string
  }

  const members: MemberRow[] = (memberships ?? []).map((m) => {
    const u = usersById[m.user_id as string]
    return {
      id: m.id as string,
      user_id: m.user_id as string,
      roles: ((m.roles as OrgRole[] | undefined) ?? []),
      given_name: u?.given_name ?? '',
      family_name: u?.family_name ?? '',
      primary_email: u?.primary_email ?? '',
    }
  })

  const adminCount = members.filter((m) => m.roles.includes('client_admin')).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Toggle roles for each member. Roles are additive — one person may hold several.
        </p>
      </div>

      {errorParam && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorParam}
        </div>
      )}
      {noticeParam && (
        <div className="rounded-md border border-blue-500/50 bg-blue-500/10 px-4 py-3 text-sm text-blue-700">
          {noticeParam}
        </div>
      )}

      <div className="space-y-3">
        {members.map((member) => {
          const isMe = member.user_id === user.id
          return (
            <div
              key={member.id}
              className="rounded-lg border bg-card px-4 py-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {member.given_name} {member.family_name}
                    {isMe && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{member.primary_email}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {TOGGLEABLE_ROLES.map((role) => {
                  const hasRole = member.roles.includes(role)
                  // Disable the client_admin toggle when this member is the sole admin
                  const isLastAdmin =
                    role === 'client_admin' && hasRole && adminCount <= 1
                  return (
                    <form action={toggleRole} key={role}>
                      <input type="hidden" name="membership_id" value={member.id} />
                      <input type="hidden" name="role" value={role} />
                      <input
                        type="hidden"
                        name="action"
                        value={hasRole ? 'revoke' : 'grant'}
                      />
                      <button
                        type="submit"
                        disabled={isLastAdmin}
                        title={
                          isLastAdmin
                            ? 'Cannot remove the last admin — grant admin to another member first'
                            : undefined
                        }
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors
                          disabled:cursor-not-allowed disabled:opacity-40
                          ${
                            hasRole
                              ? 'bg-foreground/90 text-background hover:bg-foreground/75'
                              : 'border border-border text-muted-foreground hover:bg-muted'
                          }`}
                      >
                        {hasRole ? '✓ ' : '+ '}{ROLE_LABELS[role]}
                      </button>
                    </form>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Inviting new colleagues to the org is not yet available in-app — contact support.
      </p>
    </div>
  )
}
