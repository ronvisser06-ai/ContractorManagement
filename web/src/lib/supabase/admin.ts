import { createClient } from '@supabase/supabase-js'

// Service-role client for server-side workflows (Inngest) that must act on a
// job regardless of which user's session originally triggered it — durable
// steps can run well after the triggering request ends. Bypasses RLS; never
// expose this to the browser.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
