-- M1 Step 4a: Allow contractor-company members to read each other's public.users
-- profile rows so the worker roster embedded select works under RLS.
--
-- Without this, the contractor_admin's JWT would satisfy "company_memberships: read
-- if member or linked" for the membership rows but the embedded join to users would
-- return NULL for every row because the existing "users: read own row" policy only
-- allows id = auth.uid(). PostgREST applies RLS to the join target, so the join
-- silently returns NULL rather than erroring — the roster would show no names.
--
-- The new policy is permissive (ORed with the existing own-row policy):
-- any user who has an active company membership can read the users rows of all
-- other active members of the same company. This is consistent with the existing
-- "user_emails: read own or company admin" scope (user_emails grants the same set).

CREATE POLICY "users: company member reads" ON "users"
  FOR SELECT USING (
    id IN (
      SELECT cm.user_id
      FROM public.company_memberships cm
      WHERE cm.company_id IN (SELECT company_id FROM user_company_ids(auth.uid()))
        AND cm.status = 'active'
    )
  );
