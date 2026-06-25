-- Fix: company_memberships INSERT and UPDATE policies directly subquery the same
-- table (to check caller's contractor_admin role), which Postgres detects as
-- potential infinite recursion and refuses at runtime (code 42P17).
--
-- The same pattern is already solved for SELECT: user_company_ids() is SECURITY
-- DEFINER, so it reads company_memberships without applying RLS → no recursion.
-- We apply the same pattern here with user_admin_company_ids(), which only returns
-- companies where the caller holds the contractor_admin role.

CREATE OR REPLACE FUNCTION user_admin_company_ids(uid uuid)
RETURNS TABLE(company_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM company_memberships
  WHERE user_id = uid AND status = 'active'
    AND 'contractor_admin' = ANY(roles)
$$;

-- Drop the recursive policies and replace with function-based equivalents.
DROP POLICY IF EXISTS "company_memberships: insert if contractor_admin" ON company_memberships;
DROP POLICY IF EXISTS "company_memberships: update if contractor_admin" ON company_memberships;

CREATE POLICY "company_memberships: insert if contractor_admin" ON "company_memberships"
  FOR INSERT WITH CHECK (
    company_id IN (SELECT company_id FROM user_admin_company_ids(auth.uid()))
  );

CREATE POLICY "company_memberships: update if contractor_admin" ON "company_memberships"
  FOR UPDATE USING (
    company_id IN (SELECT company_id FROM user_admin_company_ids(auth.uid()))
  );
