// Expected-on-site (§4.5): the activated crew for a set of sites, with each
// worker's name and company. Shared by the Sites page and its test so the two
// can't drift apart. No Next.js imports — node:test imports this directly.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ActivatedWorker {
  id: string
  site_id: string
  user_id: string
  company_id: string
  users: { given_name: string; family_name: string } | null
  contractor_companies: { legal_name: string } | null
}

// site_worker_activations has TWO foreign keys to users — user_id (the worker)
// and activated_by (the Contractor Admin) — so the embed must name the FK or
// PostgREST rejects it as ambiguous (PGRST201). The users read itself resolves
// via the "users: read if activated on org site" policy (migration 0013).
const EXPECTED_ON_SITE_SELECT =
  'id, site_id, user_id, company_id, ' +
  'users!site_worker_activations_user_id_users_id_fk(given_name, family_name), ' +
  'contractor_companies(legal_name)'

export async function fetchExpectedOnSite(
  supabase: SupabaseClient,
  siteIds: string[],
): Promise<ActivatedWorker[]> {
  if (siteIds.length === 0) return []
  const { data, error } = await supabase
    .from('site_worker_activations')
    .select(EXPECTED_ON_SITE_SELECT)
    .in('site_id', siteIds)
    .eq('status', 'active')
  // Fail loudly: swallowing this error is what hid the PGRST201 bug.
  if (error) throw new Error(`expected-on-site query failed: ${error.code} ${error.message}`)
  return (data ?? []) as unknown as ActivatedWorker[]
}
