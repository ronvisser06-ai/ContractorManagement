-- F1 Step 3 — invite acceptance page.
--
-- 1. get_company_invitation(token): what the /invite/company page needs to
--    render before (and after) sign-in. RLS hides invitations from the person
--    invited, so this SECURITY DEFINER read returns only display data for a
--    company-admin invitation: company + org names, admin type, the invited
--    email (so they sign in with the right account) and its state. Never ids or
--    the token. Holding the 64-hex token is the capability; callable signed out.
-- 2. Retire the M1 flow: accept_company_invite (took a user id; already
--    service_role-only since 0018) is replaced by accept_company_admin_invite.

CREATE OR REPLACE FUNCTION get_company_invitation(p_token text)
RETURNS TABLE (
  company_name text,
  org_name     text,
  admin_type   company_admin_type,
  email        text,
  status       invitation_status,
  expired      boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cc.legal_name, o.name, i.admin_type, i.email::text, i.status, i.expires_at < now()
  FROM invitations i
  JOIN contractor_companies cc ON cc.id = i.company_id
  LEFT JOIN organizations o ON o.id = i.org_id
  WHERE i.token = p_token
    AND i.type = 'company'
    AND length(coalesce(p_token, '')) = 64
$$;

REVOKE ALL ON FUNCTION get_company_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_company_invitation(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS accept_company_invite(text, uuid, text, text);
