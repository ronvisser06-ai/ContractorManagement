-- §4.5 expected-on-site & §4.4 cross-company summary support
--
-- Problem 1: Client Admins cannot read worker user profiles.
-- Existing policies only allow own-row reads and company-member reads.
-- §4.2 says a client org may read a worker profile "only through a bridge row
-- tying that worker to one of the org's sites" (i.e., an active activation).
--
-- A naïve policy of the form:
--   id IN (SELECT user_id FROM site_worker_activations WHERE site_id IN org-sites)
-- would risk recursion: site_worker_activations' SELECT policy reads from sites,
-- which reads from user_org_ids (SECURITY DEFINER, safe), but future changes
-- could break this. We use a SECURITY DEFINER helper to break any possible cycle.

CREATE OR REPLACE FUNCTION user_ids_activated_on_org_sites(uid uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT swa.user_id
  FROM   site_worker_activations swa
  JOIN   sites s  ON s.id = swa.site_id
  JOIN   org_memberships om ON om.org_id = s.org_id
  WHERE  om.user_id = uid
    AND  om.status  = 'active'
    AND  swa.status = 'active'
$$;

-- Client/Foreman can read the profile of any worker activated on one of their
-- org's sites (the bridge-row gate described in §4.2).
CREATE POLICY "users: read if activated on org site" ON "users"
  FOR SELECT USING (
    id IN (SELECT user_id FROM user_ids_activated_on_org_sites(auth.uid()))
  );

-- Problem 2: cross-company summary (§4.4) needs total_company_count across ALL
-- of a worker's memberships, which the caller cannot see directly via RLS
-- (they only see companies linked to their own org). SECURITY DEFINER + auth.uid()
-- scoping keeps the result narrow:
--   - total_company_count: full count (bypasses RLS, needed by design)
--   - shared_companies: names only for companies that share a link with any of
--     the caller's orgs — the full cross-client picture is never exposed.

CREATE OR REPLACE FUNCTION worker_company_summary(p_worker_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_company_count',
    (
      SELECT COUNT(DISTINCT cm.company_id)::int
      FROM   company_memberships cm
      WHERE  cm.user_id = p_worker_id
        AND  cm.status  = 'active'
    ),
    'shared_companies',
    (
      SELECT COALESCE(jsonb_agg(cc.legal_name ORDER BY cc.legal_name), '[]'::jsonb)
      FROM   contractor_companies  cc
      JOIN   company_memberships   cm  ON cm.company_id  = cc.id
      JOIN   client_company_links  ccl ON ccl.company_id = cc.id
      JOIN   org_memberships       om  ON om.org_id      = ccl.org_id
      WHERE  cm.user_id  = p_worker_id
        AND  cm.status   = 'active'
        AND  ccl.status  = 'active'
        AND  om.user_id  = auth.uid()
        AND  om.status   = 'active'
    )
  )
$$;

-- Restrict direct RPC calls to signed-in users only.
REVOKE EXECUTE ON FUNCTION worker_company_summary(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION worker_company_summary(uuid) TO authenticated;
