-- M1 Step 6: Email verification token table + verify_and_link_email() RPC.
--
-- Add-email flow (self-service):
--   1. User requests verification → email_verifications row (pending)
--   2. Dev-mode: link shown in UI; Step 7 will send it by email
--   3. User visits link → calls verify_and_link_email()
--   4. RPC inserts into user_emails (verified_at = now()) and re-points any
--      company_memberships whose invited_email matches to the caller's identity

CREATE TABLE IF NOT EXISTS email_verifications (
  id          text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users(id),
  email       citext      NOT NULL,
  token       text        NOT NULL UNIQUE,
  status      text        NOT NULL DEFAULT 'pending',  -- pending | used
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;

-- Owner can see their own verification requests (dev-mode: to display the link).
CREATE POLICY "email_verifications: read own" ON email_verifications
  FOR SELECT USING (user_id = auth.uid());

-- Owner can insert their own verification requests.
CREATE POLICY "email_verifications: insert own" ON email_verifications
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ── verify_and_link_email ─────────────────────────────────────────────────────
-- Atomically:
--   1. Validates the token (belongs to caller, pending, not expired)
--   2. Guards: rejects if the email is already verified to a different identity
--   3. Inserts into user_emails (verified_at = now())
--   4. Re-points any company_memberships where invited_email = this email
--      to the caller, advancing onboarding_status to account_created
--      (same merge logic as claim_worker_invite — handles duplicate provisional)
--   5. Marks the token used
-- Returns jsonb { email, linked_companies: [company_id, ...] }
--
-- SECURITY DEFINER is required so the cross-user uniqueness check on user_emails
-- and the membership re-pointing (which may touch a provisional user's rows)
-- bypass the caller's RLS policies.

CREATE OR REPLACE FUNCTION verify_and_link_email(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id  uuid;
  v_email      citext;
  v_expires_at timestamptz;
  v_ev_status  text;
  v_is_primary bool;
  v_linked     text[] := '{}';
  v_cm         RECORD;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock the row to prevent concurrent double-verification races.
  SELECT email, expires_at, status
  INTO   v_email, v_expires_at, v_ev_status
  FROM   email_verifications
  WHERE  token = p_token AND user_id = v_caller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  IF v_ev_status != 'pending' THEN
    RAISE EXCEPTION 'already_used';
  END IF;

  IF v_expires_at < NOW() THEN
    RAISE EXCEPTION 'expired';
  END IF;

  -- Guard: email must not already belong to a different verified identity.
  IF EXISTS (
    SELECT 1 FROM user_emails
    WHERE email = v_email AND user_id != v_caller_id
  ) THEN
    RAISE EXCEPTION 'email_taken';
  END IF;

  -- Insert into user_emails (idempotent: skip if already present).
  IF NOT EXISTS (
    SELECT 1 FROM user_emails
    WHERE email = v_email AND user_id = v_caller_id
  ) THEN
    -- Make primary only if the account has no primary yet.
    v_is_primary := NOT EXISTS (
      SELECT 1 FROM user_emails WHERE user_id = v_caller_id AND is_primary = TRUE
    );

    INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, added_at)
    VALUES (
      'ueml_' || replace(gen_random_uuid()::text, '-', ''),
      v_caller_id,
      v_email,
      v_is_primary,
      NOW(),
      NOW()
    );
  ELSE
    -- Already present — stamp verified_at if not already set.
    UPDATE user_emails
    SET    verified_at = COALESCE(verified_at, NOW())
    WHERE  email   = v_email
      AND  user_id = v_caller_id
      AND  verified_at IS NULL;
  END IF;

  -- Re-point pending memberships that targeted this email (§5 reconciliation).
  FOR v_cm IN
    SELECT id, user_id AS provisional_id, company_id
    FROM   company_memberships
    WHERE  invited_email      = v_email
      AND  onboarding_status != 'account_created'
      AND  status             = 'active'
  LOOP
    IF v_cm.provisional_id = v_caller_id THEN
      -- Same user already owns the membership — just advance lifecycle.
      UPDATE company_memberships
      SET    onboarding_status = 'account_created',
             updated_at        = NOW()
      WHERE  id = v_cm.id;

    ELSIF EXISTS (
      SELECT 1 FROM company_memberships
      WHERE  user_id    = v_caller_id
        AND  company_id = v_cm.company_id
    ) THEN
      -- Caller already has a membership for this company.
      -- Advance the existing membership; remove the stale provisional row.
      UPDATE company_memberships
      SET    onboarding_status = 'account_created',
             updated_at        = NOW()
      WHERE  user_id    = v_caller_id
        AND  company_id = v_cm.company_id;

      DELETE FROM company_memberships WHERE id = v_cm.id;

    ELSE
      -- Re-point the provisional membership to the caller's identity.
      UPDATE company_memberships
      SET    user_id           = v_caller_id,
             onboarding_status = 'account_created',
             updated_at        = NOW()
      WHERE  id = v_cm.id;
    END IF;

    v_linked := v_linked || v_cm.company_id;
  END LOOP;

  -- Consume the token — single use.
  UPDATE email_verifications
  SET    status = 'used'
  WHERE  token  = p_token;

  RETURN jsonb_build_object(
    'email',            v_email,
    'linked_companies', v_linked
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_and_link_email(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION verify_and_link_email(text) TO authenticated;
