-- M2.5 F1: a client org defines its contractor companies and nominates their admins.
--
-- * company_memberships.admin_type says how an admin came to be one: in_house (an existing user of the
--   nominating org), external (the company's own person, invited by email) or third_party (someone who
--   administers it on the company's behalf, such as a safety consultant). Set exactly when the row holds
--   contractor_admin; workers have none.
-- * contractor_companies.defined_by_org_id is the org that typed the company in. Only that org may nominate
--   admins for it. An org that LINKS to a company someone else defined gets a link the company's admin must
--   accept, and nothing more.
-- * Matching is by normalised name or contact email, and returns only an id and a name, so one client cannot
--   learn anything else about another's contractor.
-- * Every rule lives in these functions (security definer, checking auth.uid()), so the UI and anything else behave
--   the same. ids and the invite token are passed in: the app already makes them.

CREATE TYPE company_admin_type AS ENUM ('in_house', 'external', 'third_party');

ALTER TABLE company_memberships
  ADD COLUMN admin_type company_admin_type,
  ADD COLUMN nominated_by_org_id text REFERENCES organizations(id);
-- Everyone who is a contractor_admin today accepted an email invite.
UPDATE company_memberships SET admin_type = 'external' WHERE 'contractor_admin' = ANY(roles);
ALTER TABLE company_memberships
  ADD CONSTRAINT company_memberships_admin_type_matches_role
  CHECK (('contractor_admin' = ANY(roles)) = (admin_type IS NOT NULL));

ALTER TABLE invitations ADD COLUMN admin_type company_admin_type;
UPDATE invitations SET admin_type = 'external' WHERE type = 'company';

ALTER TABLE contractor_companies ADD COLUMN defined_by_org_id text REFERENCES organizations(id);

-- ── matching ──────────────────────────────────────────────────────────────────
-- "Acme Construction Ltd." and "ACME Construction, Ltd" are one company. Lower case, "&" as "and", punctuation and
-- spaces gone, then ONE trailing legal suffix off.
CREATE OR REPLACE FUNCTION normalise_company_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(
    regexp_replace(lower(replace(coalesce(p_name, ''), '&', ' and ')), '[^a-z0-9]+', ' ', 'g'),
    '\s*\m(ltd|limited|inc|incorporated|corp|corporation|co|company|llc|lp|ltee)\M\s*$', '', 'g'
  )
$$;

ALTER TABLE contractor_companies
  ADD COLUMN normalized_name text GENERATED ALWAYS AS (replace(normalise_company_name(legal_name), ' ', '')) STORED;
CREATE INDEX contractor_companies_normalized_name_idx ON contractor_companies (normalized_name);

-- ── who may do what ───────────────────────────────────────────────────────────
-- The caller is a client admin of the org, or it is refused.
CREATE OR REPLACE FUNCTION assert_client_admin(p_org text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT user_is_org_admin(auth.uid(), p_org) THEN
    RAISE EXCEPTION 'Only a Client Admin of this organization can do that';
  END IF;
END $$;
REVOKE ALL ON FUNCTION assert_client_admin(text) FROM PUBLIC, anon, authenticated;

-- ── find an existing company ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_contractor_companies(p_org text, p_name text, p_contact_email text DEFAULT NULL)
RETURNS TABLE (company_id text, legal_name text, already_linked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := replace(normalise_company_name(p_name), ' ', '');
BEGIN
  PERFORM assert_client_admin(p_org);
  RETURN QUERY
    SELECT c.id, c.legal_name,
           EXISTS (SELECT 1 FROM client_company_links l WHERE l.org_id = p_org AND l.company_id = c.id)
    FROM contractor_companies c
    WHERE c.status = 'active'
      AND ((v_key <> '' AND c.normalized_name = v_key)
           OR (nullif(trim(p_contact_email), '') IS NOT NULL AND c.contact_email = trim(p_contact_email)::citext))
    ORDER BY c.created_at
    LIMIT 5;
END $$;

-- ── define a company, or link to the one that is already there ────────────────
-- Link to an existing company: it must be one the match above would offer (never an arbitrary id), and the link waits
-- as 'invited' for that company's admin to accept. Create: refused while a match exists unless p_create_anyway.
CREATE OR REPLACE FUNCTION define_contractor_company(
  p_org text, p_company_id text, p_link_id text,
  p_legal_name text, p_contact_name text, p_contact_email text, p_contact_phone text, p_trade_types text[],
  p_link_existing text DEFAULT NULL, p_create_anyway boolean DEFAULT false
) RETURNS TABLE (company_id text, linked_existing boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_existing text;
BEGIN
  PERFORM assert_client_admin(p_org);
  IF trim(coalesce(p_legal_name, '')) = '' THEN RAISE EXCEPTION 'Company name is required'; END IF;

  IF p_link_existing IS NOT NULL THEN
    SELECT m.company_id INTO v_existing FROM match_contractor_companies(p_org, p_legal_name, p_contact_email) m
    WHERE m.company_id = p_link_existing;
    IF v_existing IS NULL THEN RAISE EXCEPTION 'That company does not match what you entered'; END IF;
    INSERT INTO client_company_links (id, org_id, company_id, status) VALUES (p_link_id, p_org, v_existing, 'invited')
    ON CONFLICT (org_id, company_id) DO NOTHING;
    RETURN QUERY SELECT v_existing, true;
    RETURN;
  END IF;

  IF NOT p_create_anyway AND EXISTS (SELECT 1 FROM match_contractor_companies(p_org, p_legal_name, p_contact_email)) THEN
    RAISE EXCEPTION 'A company like this already exists: link to it, or choose to create it anyway';
  END IF;

  INSERT INTO contractor_companies (id, legal_name, trade_types, contact_name, contact_email, contact_phone, defined_by_org_id)
  VALUES (p_company_id, trim(p_legal_name), coalesce(p_trade_types, '{}'), nullif(trim(p_contact_name), ''),
          nullif(trim(p_contact_email), '')::citext, nullif(trim(p_contact_phone), ''), p_org);
  INSERT INTO client_company_links (id, org_id, company_id, status) VALUES (p_link_id, p_org, p_company_id, 'invited');
  RETURN QUERY SELECT p_company_id, false;
END $$;

-- ── nominate an admin ─────────────────────────────────────────────────────────
-- Only the org that DEFINED the company. in_house: an active member of that org becomes an admin at once and the link
-- goes active. external / third_party: an invitation by email (the app sends it with the token passed in).
CREATE OR REPLACE FUNCTION nominate_company_admin(
  p_org text, p_company text, p_type company_admin_type, p_id text,
  p_user_id uuid DEFAULT NULL, p_email text DEFAULT NULL, p_token text DEFAULT NULL
) RETURNS text   -- the invitation token for an email nominee; null for an in-house one
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email citext := nullif(trim(coalesce(p_email, '')), '')::citext;
BEGIN
  PERFORM assert_client_admin(p_org);
  IF NOT EXISTS (SELECT 1 FROM contractor_companies WHERE id = p_company AND defined_by_org_id = p_org) THEN
    RAISE EXCEPTION 'You can nominate admins only for a company your organization defined';
  END IF;

  IF p_type = 'in_house' THEN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'Choose a member of your organization'; END IF;
    IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE org_id = p_org AND user_id = p_user_id AND status = 'active') THEN
      RAISE EXCEPTION 'That person is not an active member of your organization';
    END IF;
    INSERT INTO company_memberships (id, user_id, company_id, roles, onboarding_status, status, admin_type, nominated_by_org_id)
    VALUES (p_id, p_user_id, p_company, ARRAY['contractor_admin']::company_role[], 'account_created', 'active', 'in_house', p_org)
    ON CONFLICT (user_id, company_id) DO UPDATE
      SET roles = (SELECT array_agg(DISTINCT r) FROM unnest(company_memberships.roles || ARRAY['contractor_admin']::company_role[]) r),
          admin_type = coalesce(company_memberships.admin_type, 'in_house'),
          nominated_by_org_id = coalesce(company_memberships.nominated_by_org_id, p_org),
          status = 'active', updated_at = now();
    UPDATE client_company_links SET status = 'active', accepted_at = coalesce(accepted_at, now())
    WHERE org_id = p_org AND company_id = p_company AND status = 'invited';
    RETURN NULL;
  END IF;

  IF v_email IS NULL THEN RAISE EXCEPTION 'An email address is required'; END IF;
  IF p_token IS NULL OR length(p_token) < 32 THEN RAISE EXCEPTION 'A token is required'; END IF;
  IF EXISTS (SELECT 1 FROM invitations WHERE company_id = p_company AND email = v_email AND type = 'company' AND status = 'pending') THEN
    RAISE EXCEPTION 'A pending invite already exists for this email';
  END IF;
  INSERT INTO invitations (id, type, token, channel, email, org_id, company_id, intended_roles, status, expires_at, created_by, admin_type)
  VALUES (p_id, 'company', p_token, 'email', v_email, p_org, p_company, ARRAY['contractor_admin'], 'pending', now() + interval '7 days', auth.uid(), p_type);
  RETURN p_token;
END $$;

-- ── add or remove an admin from the company's side, and accept a link ─────────
-- An admin of the company (or, for one it nominated, the org that defined it) may remove an admin; the last active
-- admin of a company that has any cannot be removed.
CREATE OR REPLACE FUNCTION remove_company_admin(p_membership text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m company_memberships;
  v_allowed boolean;
BEGIN
  SELECT * INTO m FROM company_memberships WHERE id = p_membership FOR UPDATE;
  IF NOT FOUND OR NOT ('contractor_admin' = ANY(m.roles)) OR m.status <> 'active' THEN
    RAISE EXCEPTION 'No such admin';
  END IF;
  v_allowed := m.company_id IN (SELECT user_admin_company_ids(auth.uid()))
            OR (m.nominated_by_org_id IS NOT NULL AND user_is_org_admin(auth.uid(), m.nominated_by_org_id));
  IF NOT v_allowed THEN RAISE EXCEPTION 'You cannot remove this admin'; END IF;
  IF (SELECT count(*) FROM company_memberships
      WHERE company_id = m.company_id AND status = 'active' AND 'contractor_admin' = ANY(roles)) <= 1 THEN
    RAISE EXCEPTION 'A company needs at least one admin: add another before removing this one';
  END IF;
  UPDATE company_memberships
  SET roles = array_remove(roles, 'contractor_admin'::company_role),
      admin_type = NULL, nominated_by_org_id = NULL,
      status = CASE WHEN 'worker' = ANY(roles) THEN status ELSE 'disabled' END,
      updated_at = now()
  WHERE id = p_membership;
END $$;

CREATE OR REPLACE FUNCTION respond_to_company_link(p_link text, p_accept boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l client_company_links;
BEGIN
  SELECT * INTO l FROM client_company_links WHERE id = p_link FOR UPDATE;
  IF NOT FOUND OR l.status <> 'invited' THEN RAISE EXCEPTION 'No such pending link'; END IF;
  IF l.company_id NOT IN (SELECT user_admin_company_ids(auth.uid())) THEN
    RAISE EXCEPTION 'Only an admin of the company can answer this';
  END IF;
  IF p_accept THEN
    UPDATE client_company_links SET status = 'active', accepted_at = now() WHERE id = p_link;
  ELSE
    DELETE FROM client_company_links WHERE id = p_link;
  END IF;
END $$;

-- ── the company's own side: see and manage its admins and link requests ───────
CREATE OR REPLACE FUNCTION assert_company_admin(p_company text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_company NOT IN (SELECT user_admin_company_ids(auth.uid())) THEN
    RAISE EXCEPTION 'Only an admin of this company can do that';
  END IF;
END $$;
REVOKE ALL ON FUNCTION assert_company_admin(text) FROM PUBLIC, anon, authenticated;

-- Admins and pending admin invitations in one list. Names and emails are the company's own people's, shown to its admins.
CREATE OR REPLACE FUNCTION list_company_admins(p_company text)
RETURNS TABLE (membership_id text, invitation_id text, name text, email text, admin_type company_admin_type,
               nominated_by text, pending boolean, since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_company_admin(p_company);
  RETURN QUERY
    SELECT m.id, NULL::text, trim(u.given_name || ' ' || u.family_name), u.primary_email::text, m.admin_type,
           (SELECT o.name FROM organizations o WHERE o.id = m.nominated_by_org_id), false, m.created_at
    FROM company_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.company_id = p_company AND m.status = 'active' AND 'contractor_admin' = ANY(m.roles)
    UNION ALL
    SELECT NULL::text, i.id, NULL::text, i.email::text, i.admin_type,
           (SELECT o.name FROM organizations o WHERE o.id = i.org_id), true, i.created_at
    FROM invitations i
    WHERE i.company_id = p_company AND i.type = 'company' AND i.status = 'pending' AND i.expires_at > now()
    ORDER BY 8;
END $$;

-- A company's admins can invite another admin: an external or third-party person, by email.
CREATE OR REPLACE FUNCTION add_company_admin(p_company text, p_type company_admin_type, p_id text, p_email text, p_token text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email citext := nullif(trim(coalesce(p_email, '')), '')::citext;
BEGIN
  PERFORM assert_company_admin(p_company);
  IF p_type = 'in_house' THEN RAISE EXCEPTION 'In-house admins are nominated by the client organization'; END IF;
  IF v_email IS NULL THEN RAISE EXCEPTION 'An email address is required'; END IF;
  IF p_token IS NULL OR length(p_token) < 32 THEN RAISE EXCEPTION 'A token is required'; END IF;
  IF EXISTS (SELECT 1 FROM invitations WHERE company_id = p_company AND email = v_email AND type = 'company' AND status = 'pending') THEN
    RAISE EXCEPTION 'A pending invite already exists for this email';
  END IF;
  INSERT INTO invitations (id, type, token, channel, email, org_id, company_id, intended_roles, status, expires_at, created_by, admin_type)
  VALUES (p_id, 'company', p_token, 'email', v_email, NULL, p_company, ARRAY['contractor_admin'], 'pending', now() + interval '7 days', auth.uid(), p_type);
  RETURN p_token;
END $$;

CREATE OR REPLACE FUNCTION revoke_company_admin_invite(p_invitation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company text;
BEGIN
  SELECT company_id INTO v_company FROM invitations WHERE id = p_invitation AND type = 'company' AND status = 'pending' FOR UPDATE;
  IF v_company IS NULL THEN RAISE EXCEPTION 'No such pending invitation'; END IF;
  PERFORM assert_company_admin(v_company);
  UPDATE invitations SET status = 'revoked' WHERE id = p_invitation;
END $$;

-- Which client organizations have asked to link to the company, by name.
CREATE OR REPLACE FUNCTION list_pending_company_links(p_company text)
RETURNS TABLE (link_id text, org_name text, invited_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_company_admin(p_company);
  RETURN QUERY
    SELECT l.id, o.name, l.invited_at
    FROM client_company_links l
    JOIN organizations o ON o.id = l.org_id
    JOIN contractor_companies c ON c.id = l.company_id
    -- The org that defined the company is not asking permission: its own link is not a request.
    WHERE l.company_id = p_company AND l.status = 'invited' AND l.org_id IS DISTINCT FROM c.defined_by_org_id
    ORDER BY l.invited_at;
END $$;

-- ── accepting an invitation keeps what the org typed, and records the admin type ──
CREATE OR REPLACE FUNCTION public.accept_company_invite(
  p_token text, p_user_id uuid, p_membership_id text, p_legal_name text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company_id text;
  v_org_id text;
  v_expires_at timestamptz;
  v_inv_status invitation_status;
  v_admin_type company_admin_type;
BEGIN
  SELECT company_id, org_id, expires_at, status, admin_type
  INTO v_company_id, v_org_id, v_expires_at, v_inv_status, v_admin_type
  FROM invitations WHERE token = p_token AND type = 'company' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation token'; END IF;
  IF v_inv_status != 'pending' THEN RAISE EXCEPTION 'This invitation has already been used or revoked'; END IF;
  IF v_expires_at < NOW() THEN RAISE EXCEPTION 'This invitation has expired'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User account not found — auth signup may not have completed yet';
  END IF;
  IF trim(p_legal_name) = '' THEN RAISE EXCEPTION 'Company name cannot be empty'; END IF;

  -- A company the org already named keeps its name; only the placeholder an email-only invite made is replaced.
  UPDATE contractor_companies SET legal_name = trim(p_legal_name), updated_at = NOW()
  WHERE id = v_company_id AND legal_name LIKE 'Invited: %';

  INSERT INTO company_memberships (id, user_id, company_id, roles, onboarding_status, status, admin_type, nominated_by_org_id, created_at, updated_at)
  VALUES (p_membership_id, p_user_id, v_company_id, ARRAY['contractor_admin']::company_role[], 'account_created', 'active',
          coalesce(v_admin_type, 'external'), v_org_id, NOW(), NOW())
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET roles = (SELECT array_agg(DISTINCT r) FROM unnest(company_memberships.roles || ARRAY['contractor_admin']::company_role[]) r),
        admin_type = coalesce(company_memberships.admin_type, coalesce(v_admin_type, 'external')),
        status = 'active', updated_at = NOW();

  UPDATE client_company_links SET status = 'active', accepted_at = NOW()
  WHERE org_id = v_org_id AND company_id = v_company_id AND status = 'invited';

  UPDATE invitations SET status = 'accepted', accepted_user_id = p_user_id, accepted_at = NOW() WHERE token = p_token;
  RETURN v_company_id;
END $$;

REVOKE ALL ON FUNCTION list_company_admins(text), add_company_admin(text, company_admin_type, text, text, text),
  revoke_company_admin_invite(text), list_pending_company_links(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_company_admins(text), add_company_admin(text, company_admin_type, text, text, text),
  revoke_company_admin_invite(text), list_pending_company_links(text) TO authenticated;

REVOKE ALL ON FUNCTION match_contractor_companies(text, text, text), define_contractor_company(text, text, text, text, text, text, text, text[], text, boolean),
  nominate_company_admin(text, text, company_admin_type, text, uuid, text, text), remove_company_admin(text), respond_to_company_link(text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_contractor_companies(text, text, text), define_contractor_company(text, text, text, text, text, text, text, text[], text, boolean),
  nominate_company_admin(text, text, company_admin_type, text, uuid, text, text), remove_company_admin(text), respond_to_company_link(text, boolean)
  TO authenticated;
