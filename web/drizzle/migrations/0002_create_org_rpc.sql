-- Atomically creates an organization and grants the caller client_admin.
-- SECURITY DEFINER runs as the function owner (postgres), bypassing RLS so:
--   (a) the membership INSERT is allowed without an RLS INSERT policy for users, and
--   (b) the client_admin role cannot be self-granted via normal table access.
-- auth.uid() is still the caller's UID because Supabase preserves session-level
-- JWT claims even inside SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION public.create_organization(
  p_org_id       text,
  p_org_name     text,
  p_membership_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF trim(p_org_name) = '' THEN
    RAISE EXCEPTION 'Organization name cannot be empty';
  END IF;

  INSERT INTO public.organizations (id, name, status, settings, created_at, updated_at)
  VALUES (p_org_id, trim(p_org_name), 'active', '{}'::jsonb, NOW(), NOW());

  INSERT INTO public.org_memberships (id, user_id, org_id, roles, status, created_at)
  VALUES (
    p_membership_id,
    auth.uid(),
    p_org_id,
    ARRAY['client_admin']::public.org_role[],
    'active',
    NOW()
  );

  RETURN p_org_id;
END;
$$;
