-- Contractor company members need to read site names for sites their company is
-- assigned to (crew page). The existing "sites: read if org member" only covers
-- client-side users; contractor-side users have company_memberships, not
-- org_memberships.
--
-- A naive policy of the form:
--   id IN (SELECT site_id FROM site_company_assignments WHERE ...)
-- would cause infinite recursion: site_company_assignments' SELECT policy reads
-- from sites, which would re-trigger this new sites policy.
--
-- The SECURITY DEFINER helper bypasses RLS on both tables and breaks the cycle.

CREATE OR REPLACE FUNCTION site_ids_for_company(uid uuid)
RETURNS TABLE(site_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT sca.site_id
  FROM   site_company_assignments sca
  JOIN   company_memberships cm ON cm.company_id = sca.company_id
  WHERE  cm.user_id = uid
    AND  cm.status  = 'active'
    AND  sca.status = 'active'
$$;

-- Allow contractor company members to read site details for their assigned sites.
CREATE POLICY "sites: read if company assigned" ON "sites"
  FOR SELECT USING (
    id IN (SELECT site_id FROM site_ids_for_company(auth.uid()))
  );
