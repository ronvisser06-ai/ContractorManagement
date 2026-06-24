import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createOrg } from './actions'

interface Props {
  searchParams: Promise<{ error?: string }>
}

export default async function CreateOrgPage({ searchParams }: Props) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // If the user already has an org, skip onboarding
  const { data: existing } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)

  if (existing && existing.length > 0) redirect('/app')

  const { error } = await searchParams

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create your organization
          </h1>
          <p className="text-muted-foreground text-sm">
            This is the client company that owns sites and orientations.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form action={createOrg} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Organization name</Label>
            <Input
              id="name"
              name="name"
              placeholder="Acme Industrial Ltd."
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full">
            Create organization
          </Button>
        </form>
      </div>
    </div>
  )
}
