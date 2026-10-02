-- M2.5 F2a: a platform-wide capability catalog and the capabilities each contractor company holds (decision D2).
--
-- * `capabilities` is the shared list (seeded below, in this project's own wording; no proprietary classification), the same for
--   every client, so companies can be compared and filtered. Everyone signed in may read it; nobody writes it through the app,
--   it is curated by the platform operator in SQL. An entry is retired, never deleted, so a company that holds it keeps it.
-- * `company_capabilities` is what a company holds: a catalog entry, or a custom label where none fits. A company's admins set
--   the whole list through set_company_capabilities(); there is no direct insert, update or delete. Readable by the company's
--   own people and by the organizations it is actively linked to (who can then filter by it).
-- * Free-text trade_types are copied in (a label that matches a catalog entry becomes that entry; the rest become custom
--   labels). The column stays until the screens stop using it (F2b), which then drops it.

CREATE TABLE capabilities (
  id         text PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label      text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 80),
  category   text NOT NULL CHECK (char_length(trim(category)) BETWEEN 1 AND 80),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_capabilities (
  id            text PRIMARY KEY,
  company_id    text NOT NULL REFERENCES contractor_companies(id) ON DELETE CASCADE,
  capability_id text REFERENCES capabilities(id),
  custom_label  text CHECK (char_length(trim(custom_label)) BETWEEN 1 AND 80),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_capabilities_one_kind CHECK (num_nonnulls(capability_id, custom_label) = 1)
);
CREATE UNIQUE INDEX company_capabilities_catalog_idx ON company_capabilities (company_id, capability_id) WHERE capability_id IS NOT NULL;
CREATE UNIQUE INDEX company_capabilities_custom_idx ON company_capabilities (company_id, lower(custom_label)) WHERE custom_label IS NOT NULL;
CREATE INDEX company_capabilities_by_capability_idx ON company_capabilities (capability_id) WHERE capability_id IS NOT NULL;

-- ── access: reads by policy, writes only through the function ─────────────────
ALTER TABLE capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON capabilities, company_capabilities FROM anon, authenticated;
GRANT SELECT ON capabilities, company_capabilities TO authenticated;

CREATE POLICY "capabilities: read if signed in" ON capabilities FOR SELECT TO authenticated USING (true);
CREATE POLICY "company_capabilities: read if member or linked" ON company_capabilities FOR SELECT TO authenticated
  USING (company_id IN (SELECT company_id FROM user_company_ids(auth.uid()))
      OR company_id IN (SELECT company_id FROM org_linked_company_ids(auth.uid())));

-- ── matching a typed label to the catalog ─────────────────────────────────────
-- "Electrical", "electrical " and "ELECTRICAL" are one thing; punctuation and spacing do not matter.
CREATE OR REPLACE FUNCTION capability_key(p_label text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(lower(coalesce(p_label, '')), '[^a-z0-9]+', '', 'g')
$$;

-- Replaces a company's capabilities with exactly these: catalog entries by id, and custom labels. A custom label that
-- is a catalog entry's name is stored as that entry. Only a company's admins may call it; a retired entry may be kept
-- by a company that already holds it, but not newly added.
CREATE OR REPLACE FUNCTION set_company_capabilities(p_company text, p_catalog text[], p_custom text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_catalog text[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_catalog, '{}')));
  v_label text;
  v_hit text;
  v_custom text[] := '{}';
  v_seen text[] := '{}';
  v_id text;
BEGIN
  PERFORM assert_company_admin(p_company);
  PERFORM 1 FROM contractor_companies WHERE id = p_company FOR UPDATE;

  IF EXISTS (SELECT 1 FROM unnest(v_catalog) c WHERE NOT EXISTS (SELECT 1 FROM capabilities k WHERE k.id = c)) THEN
    RAISE EXCEPTION 'Unknown capability';
  END IF;
  IF EXISTS (
    SELECT 1 FROM capabilities k
    WHERE k.id = ANY(v_catalog) AND k.retired_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM company_capabilities h WHERE h.company_id = p_company AND h.capability_id = k.id)
  ) THEN
    RAISE EXCEPTION 'That capability is retired';
  END IF;

  FOREACH v_label IN ARRAY coalesce(p_custom, '{}') LOOP
    v_label := trim(regexp_replace(v_label, '\s+', ' ', 'g'));
    CONTINUE WHEN v_label = '';
    IF char_length(v_label) > 80 THEN RAISE EXCEPTION 'A capability name is at most 80 characters'; END IF;
    IF capability_key(v_label) = '' THEN RAISE EXCEPTION 'A capability name needs letters or digits'; END IF;
    -- A name that is a live catalog entry's name is that entry.
    SELECT k.id INTO v_hit FROM capabilities k
    WHERE k.retired_at IS NULL AND (capability_key(k.label) = capability_key(v_label) OR capability_key(k.code) = capability_key(v_label)) LIMIT 1;
    IF v_hit IS NOT NULL THEN
      v_catalog := array_append(v_catalog, v_hit);
    ELSIF NOT (capability_key(v_label) = ANY(v_seen)) THEN
      v_seen := array_append(v_seen, capability_key(v_label));
      v_custom := array_append(v_custom, v_label);
    END IF;
  END LOOP;
  v_catalog := ARRAY(SELECT DISTINCT unnest(v_catalog));

  IF cardinality(v_catalog) + cardinality(v_custom) > 60 THEN RAISE EXCEPTION 'A company can hold at most 60 capabilities'; END IF;

  DELETE FROM company_capabilities
  WHERE company_id = p_company
    AND ((capability_id IS NOT NULL AND NOT (capability_id = ANY(v_catalog)))
         OR (custom_label IS NOT NULL AND NOT (capability_key(custom_label) = ANY(v_seen))));
  INSERT INTO company_capabilities (id, company_id, capability_id)
  SELECT 'ccap_' || replace(gen_random_uuid()::text, '-', ''), p_company, c FROM unnest(v_catalog) c
  ON CONFLICT DO NOTHING;
  FOREACH v_label IN ARRAY v_custom LOOP
    INSERT INTO company_capabilities (id, company_id, custom_label)
    VALUES ('ccap_' || replace(gen_random_uuid()::text, '-', ''), p_company, v_label)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN (SELECT count(*)::int FROM company_capabilities WHERE company_id = p_company);
END $$;

REVOKE ALL ON FUNCTION set_company_capabilities(text, text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_company_capabilities(text, text[], text[]) TO authenticated;
REVOKE ALL ON FUNCTION capability_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION capability_key(text) TO authenticated;

-- A company the org defines starts with the trades typed on the form: the same rule, without the company's admin
-- (there is none yet). Internal: only define_contractor_company calls it.
CREATE OR REPLACE FUNCTION add_capability_labels(p_company text, p_labels text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_label text;
  v_hit text;
BEGIN
  FOREACH v_label IN ARRAY coalesce(p_labels, '{}') LOOP
    v_label := trim(regexp_replace(v_label, '\s+', ' ', 'g'));
    CONTINUE WHEN v_label = '' OR char_length(v_label) > 80 OR capability_key(v_label) = '';
    SELECT k.id INTO v_hit FROM capabilities k
    WHERE k.retired_at IS NULL AND (capability_key(k.label) = capability_key(v_label) OR capability_key(k.code) = capability_key(v_label)) LIMIT 1;
    IF v_hit IS NOT NULL THEN
      INSERT INTO company_capabilities (id, company_id, capability_id) VALUES ('ccap_' || replace(gen_random_uuid()::text, '-', ''), p_company, v_hit) ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO company_capabilities (id, company_id, custom_label) VALUES ('ccap_' || replace(gen_random_uuid()::text, '-', ''), p_company, v_label) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION add_capability_labels(text, text[]) FROM PUBLIC, anon, authenticated;

-- define_contractor_company (0019) with trades now stored as capabilities. The trade_types column is no longer written.
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

  INSERT INTO contractor_companies (id, legal_name, contact_name, contact_email, contact_phone, defined_by_org_id)
  VALUES (p_company_id, trim(p_legal_name), nullif(trim(p_contact_name), ''),
          nullif(trim(p_contact_email), '')::citext, nullif(trim(p_contact_phone), ''), p_org);
  PERFORM add_capability_labels(p_company_id, p_trade_types);
  INSERT INTO client_company_links (id, org_id, company_id, status) VALUES (p_link_id, p_org, p_company_id, 'invited');
  RETURN QUERY SELECT p_company_id, false;
END $$;

-- ── the catalog, in this project's own wording ────────────────────────────────
INSERT INTO capabilities (id, code, label, category) VALUES
  ('cap_civil_earthworks', 'earthworks', 'Earthworks and excavation', 'Civil and site'),
  ('cap_civil_paving', 'paving', 'Paving and asphalt', 'Civil and site'),
  ('cap_civil_underground', 'underground-utilities', 'Underground utilities', 'Civil and site'),
  ('cap_civil_piling', 'piling-foundations', 'Piling and foundations', 'Civil and site'),
  ('cap_civil_demolition', 'demolition', 'Demolition', 'Civil and site'),
  ('cap_civil_landscaping', 'landscaping', 'Landscaping and site restoration', 'Civil and site'),
  ('cap_struct_concrete', 'concrete', 'Concrete and formwork', 'Structural'),
  ('cap_struct_steel', 'structural-steel', 'Structural steel erection', 'Structural'),
  ('cap_struct_rebar', 'rebar', 'Rebar placing', 'Structural'),
  ('cap_struct_masonry', 'masonry', 'Masonry', 'Structural'),
  ('cap_struct_carpentry', 'carpentry', 'Carpentry and framing', 'Structural'),
  ('cap_struct_rigging', 'rigging-crane', 'Rigging and crane services', 'Structural'),
  ('cap_mech_piping', 'piping', 'Piping and pipefitting', 'Mechanical'),
  ('cap_mech_welding', 'welding', 'Welding and fabrication', 'Mechanical'),
  ('cap_mech_millwright', 'millwright', 'Millwright and equipment installation', 'Mechanical'),
  ('cap_mech_hvac', 'hvac', 'Heating, ventilation and air conditioning', 'Mechanical'),
  ('cap_mech_plumbing', 'plumbing', 'Plumbing', 'Mechanical'),
  ('cap_mech_sheetmetal', 'sheet-metal', 'Sheet metal', 'Mechanical'),
  ('cap_elec_electrical', 'electrical', 'Electrical', 'Electrical and controls'),
  ('cap_elec_instrumentation', 'instrumentation', 'Instrumentation and controls', 'Electrical and controls'),
  ('cap_elec_powerline', 'power-line', 'Power line work', 'Electrical and controls'),
  ('cap_elec_telecom', 'telecommunications', 'Telecommunications and data cabling', 'Electrical and controls'),
  ('cap_fin_roofing', 'roofing', 'Roofing', 'Building envelope and finishes'),
  ('cap_fin_cladding', 'cladding-glazing', 'Cladding and glazing', 'Building envelope and finishes'),
  ('cap_fin_insulation', 'insulation', 'Insulation', 'Building envelope and finishes'),
  ('cap_fin_painting', 'painting-coatings', 'Painting and protective coatings', 'Building envelope and finishes'),
  ('cap_fin_drywall', 'drywall-interiors', 'Drywall and interior finishing', 'Building envelope and finishes'),
  ('cap_fin_flooring', 'flooring', 'Flooring', 'Building envelope and finishes'),
  ('cap_ind_scaffolding', 'scaffolding', 'Scaffolding', 'Industrial services'),
  ('cap_ind_blasting', 'abrasive-blasting', 'Abrasive blasting', 'Industrial services'),
  ('cap_ind_maintenance', 'turnaround-maintenance', 'Turnaround and shutdown maintenance', 'Industrial services'),
  ('cap_ind_tank', 'tank-vessel', 'Tank and vessel work', 'Industrial services'),
  ('cap_ind_nde', 'inspection-testing', 'Inspection and non-destructive testing', 'Industrial services'),
  ('cap_ind_hydrovac', 'hydrovac', 'Hydro excavation', 'Industrial services'),
  ('cap_ind_environmental', 'environmental-remediation', 'Environmental remediation', 'Industrial services'),
  ('cap_site_trucking', 'trucking-hauling', 'Trucking and hauling', 'Site support'),
  ('cap_site_equipment', 'equipment-rental', 'Equipment rental and operation', 'Site support'),
  ('cap_site_surveying', 'surveying', 'Surveying and layout', 'Site support'),
  ('cap_site_safety', 'safety-services', 'Safety services and training', 'Site support'),
  ('cap_site_labour', 'general-labour', 'General labour and staffing', 'Site support'),
  ('cap_site_catering', 'camp-catering', 'Camp, catering and janitorial', 'Site support'),
  ('cap_site_security', 'site-security', 'Site security and traffic control', 'Site support');

-- ── what companies already typed ──────────────────────────────────────────────
-- A label that is a catalog entry's name becomes that entry; the rest are kept as custom labels. Nothing is lost.
INSERT INTO company_capabilities (id, company_id, capability_id, custom_label)
SELECT DISTINCT ON (c.id, coalesce(k.id, 'custom:' || capability_key(t.label)))
       'ccap_' || replace(gen_random_uuid()::text, '-', ''), c.id, k.id, CASE WHEN k.id IS NULL THEN trim(t.label) END
FROM contractor_companies c
CROSS JOIN LATERAL unnest(c.trade_types) AS t(label)
LEFT JOIN capabilities k ON capability_key(k.label) = capability_key(t.label) OR capability_key(k.code) = capability_key(t.label)
WHERE capability_key(t.label) <> '' AND char_length(trim(t.label)) <= 80;
