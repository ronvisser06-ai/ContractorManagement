-- F1 Step 1 — Org-defined contractor companies + nominated admins.
-- (F1-OrgDefinedCompanies-Brief.md; decisions F1-1 … F1-5)
--
-- 1. SECURITY — closes three pre-existing holes (proven on ConTrak Dev 2026-10-01):
--    a. a client_admin could INSERT a client_company_links row with status
--       'active' for ANY company → instant read of its profile + workers;
--    b. a client_admin could UPDATE their own pending link to 'active';
--    c. a client_admin could INSERT a 'company' invitation for ANY company and
--       call accept_company_invite (EXECUTE granted to PUBLIC, takes a user id)
--       → become that company's contractor_admin and rename it.
--    Fix: link writes only via SECURITY DEFINER RPCs (direct insert limited to
--    'invited' links for companies the org created — the old invite flow);
--    company invitations only for companies the org created that have no admin
--    yet, or by the company's own admins; the two user-id-taking token RPCs are
--    service_role only; the new accept RPC re-checks ownership (takeover guard).
-- 2. Schema: admin types, business number, website, created_by_org_id,
--    name_key (normalized name, trigram-indexed), 'declined' link status.
-- 3. RPCs (all SECURITY DEFINER, auth.uid()-based, EXECUTE for authenticated only).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ── Types & columns ───────────────────────────────────────────────────────────

CREATE TYPE company_admin_type AS ENUM ('company_staff', 'client_staff', 'third_party');
ALTER TYPE link_status ADD VALUE IF NOT EXISTS 'declined';

ALTER TABLE company_memberships ADD COLUMN admin_type company_admin_type;
ALTER TABLE invitations ADD COLUMN admin_type company_admin_type;
ALTER TABLE contractor_companies
  ADD COLUMN business_number   text,
  ADD COLUMN website           text,
  ADD COLUMN created_by_org_id text REFERENCES organizations(id);

-- ── Normalizers (IMMUTABLE so they can back a generated column / index) ──────

-- "APEX-Scaffolding, Ltd." → "apex scaffolding"
CREATE OR REPLACE FUNCTION company_name_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'),
             '\m(ltd|limited|inc|incorporated|corp|corporation|co|company|llc|llp|lp|plc|ulc)\M', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- "bn 123-456-789" → "BN123456789"; blank → NULL
CREATE OR REPLACE FUNCTION company_business_number_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- "https://www.Example.com/about" → "example.com"; blank → NULL
CREATE OR REPLACE FUNCTION company_website_domain(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
           regexp_replace(
             regexp_replace(lower(trim(coalesce(p, ''))), '^[a-z][a-z0-9+.-]*://', ''),
             '^www\.|[/:?#].*$', '', 'g'),
           '')
$$;

ALTER TABLE contractor_companies
  ADD COLUMN name_key text GENERATED ALWAYS AS (company_name_key(legal_name)) STORED;

CREATE INDEX contractor_companies_name_key_trgm
  ON contractor_companies USING gin (name_key extensions.gin_trgm_ops);

-- Hard duplicate guard: one company per business number.
CREATE UNIQUE INDEX contractor_companies_business_number_unique
  ON contractor_companies (business_number) WHERE business_number IS NOT NULL;

-- ── Helpers (SECURITY DEFINER: evaluate regardless of the caller's RLS) ──────

CREATE OR REPLACE FUNCTION company_created_by_org(p_company_id text, p_org_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM contractor_companies
                 WHERE id = p_company_id AND created_by_org_id = p_org_id)
$$;

CREATE OR REPLACE FUNCTION company_has_active_admin(p_company_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM company_memberships
                 WHERE company_id = p_company_id AND status = 'active'
                   AND 'contractor_admin' = ANY(roles))
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────

-- The org that defined a company may read its profile (never its workers —
-- those stay gated by an ACTIVE link via org_linked_company_ids).
CREATE POLICY "contractor_companies: read if created by my org" ON contractor_companies
  FOR SELECT USING (created_by_org_id IN (SELECT org_id FROM user_org_ids(auth.uid())));

-- Links: no direct status changes by orgs; direct insert only as 'invited' and
-- only for companies the org itself created (kept for the old invite flow until
-- F1 Step 2). Everything else goes through request_company_link / RPCs.
DROP POLICY "client_company_links: insert if client_admin" ON client_company_links;
DROP POLICY "client_company_links: update if client_admin" ON client_company_links;
CREATE POLICY "client_company_links: insert invited for own company" ON client_company_links
  FOR INSERT WITH CHECK (
    status = 'invited'
    AND user_is_org_admin(auth.uid(), org_id)
    AND company_created_by_org(company_id, org_id)
  );

-- Invitations: workers by the company's admins; company-admin invitations by
-- the company's admins (no org) or by the creating org while the company has
-- no admin yet; org_user by the org's admins.
DROP POLICY "invitations: insert if admin" ON invitations;
CREATE POLICY "invitations: insert if admin" ON invitations
  FOR INSERT WITH CHECK (
    (type = 'worker' AND org_id IS NULL
      AND company_id IN (SELECT company_id FROM user_admin_company_ids(auth.uid())))
    OR (type = 'company' AND org_id IS NULL
      AND company_id IN (SELECT company_id FROM user_admin_company_ids(auth.uid())))
    OR (type = 'company' AND org_id IS NOT NULL
      AND user_is_org_admin(auth.uid(), org_id)
      AND company_created_by_org(company_id, org_id)
      AND NOT company_has_active_admin(company_id))
    OR (type = 'org_user' AND company_id IS NULL AND org_id IS NOT NULL
      AND user_is_org_admin(auth.uid(), org_id))
  );

-- Token RPCs that take a user id are called only by the server (service role).
REVOKE ALL ON FUNCTION accept_company_invite(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_company_invite(text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION claim_worker_invite(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_worker_invite(text, uuid, uuid) TO service_role;

-- ── RPC: create a company + nominate its first admin ─────────────────────────

CREATE OR REPLACE FUNCTION create_contractor_company(
  p_org_id                text,
  p_company_id            text,
  p_link_id               text,
  p_invitation_id         text,
  p_token                 text,
  p_legal_name            text,
  p_admin_email           text,
  p_admin_type            company_admin_type,
  p_trade_types           text[]  DEFAULT '{}',
  p_contact_name          text    DEFAULT NULL,
  p_contact_email         text    DEFAULT NULL,
  p_contact_phone         text    DEFAULT NULL,
  p_business_number       text    DEFAULT NULL,
  p_website               text    DEFAULT NULL,
  p_confirm_not_duplicate boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_bn text := company_business_number_key(p_business_number);
BEGIN
  IF auth.uid() IS NULL OR NOT user_is_org_admin(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'not_client_admin';
  END IF;
  IF trim(coalesce(p_legal_name, '')) = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF trim(coalesce(p_admin_email, '')) = '' THEN RAISE EXCEPTION 'admin_email_required'; END IF;
  IF p_admin_type IS NULL THEN RAISE EXCEPTION 'admin_type_required'; END IF;

  IF v_bn IS NOT NULL AND EXISTS (SELECT 1 FROM contractor_companies WHERE business_number = v_bn) THEN
    RAISE EXCEPTION 'duplicate_business_number';
  END IF;
  IF NOT p_confirm_not_duplicate AND EXISTS (
    SELECT 1 FROM contractor_companies
    WHERE name_key = company_name_key(p_legal_name) AND legal_name NOT LIKE 'Invited: %'
  ) THEN
    RAISE EXCEPTION 'possible_duplicate';
  END IF;

  INSERT INTO contractor_companies
    (id, legal_name, trade_types, contact_name, contact_email, contact_phone,
     business_number, website, created_by_org_id, status)
  VALUES
    (p_company_id, trim(p_legal_name), coalesce(p_trade_types, '{}'), nullif(trim(p_contact_name), ''),
     nullif(lower(trim(p_contact_email)), ''), nullif(trim(p_contact_phone), ''),
     v_bn, nullif(trim(p_website), ''), p_org_id, 'active');

  INSERT INTO client_company_links (id, org_id, company_id, status)
  VALUES (p_link_id, p_org_id, p_company_id, 'invited');

  INSERT INTO invitations
    (id, type, token, channel, email, org_id, company_id, intended_roles, admin_type,
     status, expires_at, created_by)
  VALUES
    (p_invitation_id, 'company', p_token, 'email', lower(trim(p_admin_email)), p_org_id, p_company_id,
     ARRAY['contractor_admin'], p_admin_type, 'pending', now() + interval '7 days', auth.uid());

  RETURN p_company_id;
END;
$$;

-- ── RPC: search existing companies (name only) ───────────────────────────────

CREATE OR REPLACE FUNCTION find_company_matches(p_org_id text, p_query text)
RETURNS TABLE (company_id text, legal_name text, link_status link_status)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_key text := company_name_key(p_query);
  v_bn  text := company_business_number_key(p_query);
  v_dom text := company_website_domain(p_query);
BEGIN
  IF auth.uid() IS NULL OR NOT user_is_org_admin(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'not_client_admin';
  END IF;
  IF length(v_key) < 2 AND (v_bn IS NULL OR length(v_bn) < 5) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT cc.id, cc.legal_name, l.status
  FROM contractor_companies cc
  LEFT JOIN client_company_links l ON l.company_id = cc.id AND l.org_id = p_org_id
  WHERE cc.status = 'active'
    AND cc.legal_name NOT LIKE 'Invited: %'
    AND (
      (length(v_key) >= 2 AND (cc.name_key % v_key OR cc.name_key LIKE '%' || v_key || '%'))
      OR (v_bn IS NOT NULL AND length(v_bn) >= 5 AND cc.business_number = v_bn)
      OR (v_dom IS NOT NULL AND position('.' IN v_dom) > 0 AND company_website_domain(cc.website) = v_dom)
    )
  ORDER BY
    (v_bn IS NOT NULL AND cc.business_number = v_bn) DESC,
    similarity(cc.name_key, v_key) DESC,
    cc.legal_name
  LIMIT 10;
END;
$$;

-- ── RPC: an org asks to link to an existing company ──────────────────────────

CREATE OR REPLACE FUNCTION request_company_link(p_org_id text, p_company_id text, p_link_id text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link_id text;
  v_status  link_status;
BEGIN
  IF auth.uid() IS NULL OR NOT user_is_org_admin(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'not_client_admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contractor_companies WHERE id = p_company_id AND status = 'active') THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;

  SELECT id, status INTO v_link_id, v_status
  FROM client_company_links WHERE org_id = p_org_id AND company_id = p_company_id
  FOR UPDATE;

  IF v_link_id IS NULL THEN
    INSERT INTO client_company_links (id, org_id, company_id, status)
    VALUES (p_link_id, p_org_id, p_company_id, 'invited');
    RETURN p_link_id;
  END IF;
  IF v_status = 'active' THEN RAISE EXCEPTION 'already_linked'; END IF;
  IF v_status <> 'invited' THEN
    UPDATE client_company_links SET status = 'invited', invited_at = now(), accepted_at = NULL
    WHERE id = v_link_id;
  END IF;
  RETURN v_link_id;
END;
$$;

-- ── RPC: the company's admin accepts or declines a link request ──────────────

CREATE OR REPLACE FUNCTION respond_to_link_request(p_link_id text, p_accept boolean)
RETURNS link_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company text;
  v_status  link_status;
  v_new     link_status;
BEGIN
  SELECT company_id, status INTO v_company, v_status
  FROM client_company_links WHERE id = p_link_id FOR UPDATE;

  IF v_company IS NULL OR auth.uid() IS NULL
     OR v_company NOT IN (SELECT company_id FROM user_admin_company_ids(auth.uid())) THEN
    RAISE EXCEPTION 'not_company_admin';
  END IF;
  IF v_status <> 'invited' THEN RAISE EXCEPTION 'not_pending'; END IF;

  v_new := CASE WHEN p_accept THEN 'active' ELSE 'declined' END;
  UPDATE client_company_links
  SET status = v_new, accepted_at = CASE WHEN p_accept THEN now() ELSE NULL END
  WHERE id = p_link_id;
  RETURN v_new;
END;
$$;

-- ── RPC: accept a company-admin invitation (signed in; email must match) ─────

CREATE OR REPLACE FUNCTION accept_company_admin_invite(p_token text, p_membership_id text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_inv FROM invitations WHERE token = p_token AND type = 'company' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'already_used'; END IF;
  IF v_inv.expires_at < now() THEN RAISE EXCEPTION 'expired'; END IF;

  -- F1-5: only the invited person (primary or verified email) may accept.
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_uid AND lower(primary_email) = lower(v_inv.email))
     AND NOT EXISTS (SELECT 1 FROM user_emails WHERE user_id = v_uid
                     AND lower(email) = lower(v_inv.email) AND verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  -- Takeover guard: the invitation must come from the creating org while the
  -- company has no admin, or from one of the company's current admins.
  IF v_inv.org_id IS NOT NULL THEN
    IF NOT company_created_by_org(v_inv.company_id, v_inv.org_id)
       OR company_has_active_admin(v_inv.company_id) THEN
      RAISE EXCEPTION 'invalid_invitation';
    END IF;
  ELSIF v_inv.company_id NOT IN (SELECT company_id FROM user_admin_company_ids(v_inv.created_by)) THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  INSERT INTO company_memberships
    (id, user_id, company_id, roles, onboarding_status, status, admin_type, created_at, updated_at)
  VALUES
    (p_membership_id, v_uid, v_inv.company_id, ARRAY['contractor_admin']::company_role[],
     'account_created', 'active', coalesce(v_inv.admin_type, 'company_staff'), now(), now())
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET roles = ARRAY(SELECT DISTINCT unnest(company_memberships.roles || 'contractor_admin'::company_role)),
        status = 'active',
        admin_type = EXCLUDED.admin_type,
        updated_at = now();

  IF v_inv.org_id IS NOT NULL THEN
    UPDATE client_company_links SET status = 'active', accepted_at = now()
    WHERE org_id = v_inv.org_id AND company_id = v_inv.company_id AND status = 'invited';
  END IF;

  UPDATE invitations SET status = 'accepted', accepted_user_id = v_uid, accepted_at = now()
  WHERE id = v_inv.id;

  RETURN v_inv.company_id;
END;
$$;

-- ── RPC: the creating org re-sends/replaces its nomination (no admin yet) ────

CREATE OR REPLACE FUNCTION replace_admin_nomination(
  p_org_id text, p_company_id text, p_invitation_id text, p_token text,
  p_email text, p_admin_type company_admin_type
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT user_is_org_admin(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'not_client_admin';
  END IF;
  IF NOT company_created_by_org(p_company_id, p_org_id) THEN RAISE EXCEPTION 'not_creator'; END IF;
  IF company_has_active_admin(p_company_id) THEN RAISE EXCEPTION 'company_has_admin'; END IF;
  IF trim(coalesce(p_email, '')) = '' OR p_admin_type IS NULL THEN RAISE EXCEPTION 'admin_email_required'; END IF;

  UPDATE invitations SET status = 'revoked'
  WHERE company_id = p_company_id AND type = 'company' AND status = 'pending';

  INSERT INTO invitations
    (id, type, token, channel, email, org_id, company_id, intended_roles, admin_type,
     status, expires_at, created_by)
  VALUES
    (p_invitation_id, 'company', p_token, 'email', lower(trim(p_email)), p_org_id, p_company_id,
     ARRAY['contractor_admin'], p_admin_type, 'pending', now() + interval '7 days', auth.uid());
END;
$$;

-- ── RPC: a company admin invites another admin ────────────────────────────────

CREATE OR REPLACE FUNCTION invite_company_admin(
  p_company_id text, p_invitation_id text, p_token text, p_email text, p_admin_type company_admin_type
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL
     OR p_company_id NOT IN (SELECT company_id FROM user_admin_company_ids(auth.uid())) THEN
    RAISE EXCEPTION 'not_company_admin';
  END IF;
  IF trim(coalesce(p_email, '')) = '' OR p_admin_type IS NULL THEN RAISE EXCEPTION 'admin_email_required'; END IF;

  INSERT INTO invitations
    (id, type, token, channel, email, org_id, company_id, intended_roles, admin_type,
     status, expires_at, created_by)
  VALUES
    (p_invitation_id, 'company', p_token, 'email', lower(trim(p_email)), NULL, p_company_id,
     ARRAY['contractor_admin'], p_admin_type, 'pending', now() + interval '7 days', auth.uid());
END;
$$;

-- ── RPC: a company admin removes an admin (never the last one) ───────────────

CREATE OR REPLACE FUNCTION remove_company_admin(p_membership_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company text;
  v_roles   company_role[];
BEGIN
  SELECT company_id, roles INTO v_company, v_roles
  FROM company_memberships
  WHERE id = p_membership_id AND status = 'active' AND 'contractor_admin' = ANY(roles)
  FOR UPDATE;

  IF v_company IS NULL OR auth.uid() IS NULL
     OR v_company NOT IN (SELECT company_id FROM user_admin_company_ids(auth.uid())) THEN
    RAISE EXCEPTION 'not_company_admin';
  END IF;

  PERFORM 1 FROM company_memberships
  WHERE company_id = v_company AND status = 'active' AND 'contractor_admin' = ANY(roles)
  FOR UPDATE;
  IF (SELECT count(*) FROM company_memberships
      WHERE company_id = v_company AND status = 'active' AND 'contractor_admin' = ANY(roles)) <= 1 THEN
    RAISE EXCEPTION 'last_admin';
  END IF;

  v_roles := array_remove(v_roles, 'contractor_admin');
  UPDATE company_memberships
  SET roles = v_roles,
      admin_type = NULL,
      status = CASE WHEN cardinality(v_roles) = 0 THEN 'disabled'::membership_status ELSE status END,
      updated_at = now()
  WHERE id = p_membership_id;
END;
$$;

-- ── Read RPCs: names for pending links (RLS hides unlinked companies/orgs) ───

CREATE OR REPLACE FUNCTION org_company_links(p_org_id text)
RETURNS TABLE (link_id text, company_id text, legal_name text, status link_status, invited_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_org_id NOT IN (SELECT org_id FROM user_org_ids(auth.uid())) THEN
    RAISE EXCEPTION 'not_org_member';
  END IF;
  RETURN QUERY
  SELECT l.id, l.company_id, cc.legal_name, l.status, l.invited_at
  FROM client_company_links l JOIN contractor_companies cc ON cc.id = l.company_id
  WHERE l.org_id = p_org_id
  ORDER BY l.invited_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION pending_link_requests(p_company_id text)
RETURNS TABLE (link_id text, org_id text, org_name text, invited_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL
     OR p_company_id NOT IN (SELECT company_id FROM user_admin_company_ids(auth.uid())) THEN
    RETURN; -- not this company's admin: nothing (no error, no leak)
  END IF;
  RETURN QUERY
  SELECT l.id, l.org_id, o.name, l.invited_at
  FROM client_company_links l JOIN organizations o ON o.id = l.org_id
  WHERE l.company_id = p_company_id AND l.status = 'invited'
  ORDER BY l.invited_at;
END;
$$;

-- ── Grants: new RPCs for signed-in users only ────────────────────────────────

REVOKE ALL ON FUNCTION create_contractor_company(text, text, text, text, text, text, text, company_admin_type, text[], text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION find_company_matches(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION request_company_link(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION respond_to_link_request(text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION accept_company_admin_invite(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION replace_admin_nomination(text, text, text, text, text, company_admin_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION invite_company_admin(text, text, text, text, company_admin_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION remove_company_admin(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION org_company_links(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pending_link_requests(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION company_created_by_org(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION company_has_active_admin(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION create_contractor_company(text, text, text, text, text, text, text, company_admin_type, text[], text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION find_company_matches(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION request_company_link(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION respond_to_link_request(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_company_admin_invite(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_admin_nomination(text, text, text, text, text, company_admin_type) TO authenticated;
GRANT EXECUTE ON FUNCTION invite_company_admin(text, text, text, text, company_admin_type) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_company_admin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION org_company_links(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pending_link_requests(text) TO authenticated;
GRANT EXECUTE ON FUNCTION company_created_by_org(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION company_has_active_admin(text) TO authenticated;
