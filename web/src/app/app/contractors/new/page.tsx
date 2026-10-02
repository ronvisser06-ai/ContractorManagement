import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActiveOrg } from '@/lib/context/server'
import { groupCatalog, type CatalogEntry } from '@/lib/companies/capabilities'
import { NewCompanyForm } from './form'

export default async function NewContractorPage() {
  const { supabase, org, hasRole } = await requireActiveOrg()
  if (!hasRole('client_admin')) redirect('/app/contractors')

  const { data: memberships } = await supabase.from('org_memberships').select('user_id').eq('org_id', org.id).eq('status', 'active')
  const ids = (memberships ?? []).map((m) => m.user_id as string)
  const { data: users } = await supabase.from('users').select('id, given_name, family_name, primary_email').in('id', ids)
  const members = (users ?? []).map((u) => ({ userId: u.id as string, name: `${u.given_name} ${u.family_name}`.trim(), email: u.primary_email as string }))

  const { data: catalog } = await supabase.from('capabilities').select('id, code, label, category, retired_at').order('category').order('label')
  const groups = groupCatalog((catalog ?? []) as CatalogEntry[], new Set())

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/app/contractors" className="text-sm text-muted-foreground hover:underline">
          ← Contractors
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add a contractor company</h1>
        <p className="text-sm text-muted-foreground">We check whether it is already on the platform before creating anything.</p>
      </div>
      <NewCompanyForm members={members} groups={groups} />
    </div>
  )
}
