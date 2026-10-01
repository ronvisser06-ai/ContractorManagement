-- F1 Step 4 — company side: the "Clients" page.
--
-- A company's admins need the names of the client orgs linked to (or asking to
-- link to) their company. RLS on organizations only lets *org members* read an
-- org, so this SECURITY DEFINER read returns, for the company's admins only,
-- each link with the org's name and status. Anyone else gets nothing (no error,
-- no leak) — same convention as pending_link_requests (0018).

CREATE OR REPLACE FUNCTION company_client_links(p_company_id text)
RETURNS TABLE (
  link_id     text,
  org_name    text,
  status      link_status,
  invited_at  timestamptz,
  accepted_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL
     OR p_company_id NOT IN (SELECT company_id FROM user_admin_company_ids(auth.uid())) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT l.id, o.name, l.status, l.invited_at, l.accepted_at
  FROM client_company_links l
  JOIN organizations o ON o.id = l.org_id
  WHERE l.company_id = p_company_id
  ORDER BY (l.status = 'invited') DESC, o.name;
END;
$$;

REVOKE ALL ON FUNCTION company_client_links(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION company_client_links(text) TO authenticated;
