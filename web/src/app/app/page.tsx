import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AppPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // All queries go through the Supabase client (anon key + user JWT) so RLS is enforced.
  const { data: profile } = await supabase
    .from('users')
    .select('given_name, family_name, primary_email')
    .eq('id', user.id)
    .single()

  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        Welcome, {profile?.given_name} {profile?.family_name}
      </h1>
      <p className="text-muted-foreground text-sm">{profile?.primary_email}</p>
    </div>
  )
}
