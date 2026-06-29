-- Role management for the Team page: lets a client_admin toggle the four
-- additive org roles (client_admin, content_developer, content_approver,
-- foreman) on any active member of their org.
--
-- Two additions:
--   1. user_is_org_admin() SECURITY DEFINER helper — lets the UPDATE policy
--      check the caller's admin status without recursing on org_memberships.
--   2. UPDATE policy on org_memberships for client_admins.
--   3. SELECT policy on users so org members can see each other's basic
--      profile (name + email) for the team list.

-- ── Helper ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION user_is_org_admin(uid uuid, p_org_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = uid
      AND org_id = p_org_id
      AND status = 'active'
      AND 'client_admin' = ANY(roles)
  )
$$;

-- ── org_memberships: UPDATE policy for client_admins ─────────────────────────
-- Allows a client_admin to update any active membership row in their org.
-- Application code (toggleRole action) restricts which columns are changed
-- (only roles[]) and enforces the last-admin guard before writing.
-- USING evaluated before the write (caller is still admin during the check).
CREATE POLICY "memberships: update roles if client_admin" ON "org_memberships"
  FOR UPDATE
  USING (user_is_org_admin(auth.uid(), org_id))
  WITH CHECK (user_is_org_admin(auth.uid(), org_id));

-- ── users: read same-org members ─────────────────────────────────────────────
-- Enables the team page's name/email display for all org members.
-- Analogous to the "users: company member reads" policy for the contractor side.
CREATE POLICY "users: read if same org member" ON "users"
  FOR SELECT USING (
    id IN (
      SELECT user_id FROM org_memberships
      WHERE org_id IN (SELECT org_id FROM user_org_ids(auth.uid()))
        AND status = 'active'
    )
  );
