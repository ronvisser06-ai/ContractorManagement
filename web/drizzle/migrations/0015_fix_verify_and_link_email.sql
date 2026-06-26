-- Patch: replace gen_random_bytes (pgcrypto, not available) with gen_random_uuid().
-- The id still has the same ueml_ prefix + 32 hex chars (UUID without dashes).

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

  IF EXISTS (
    SELECT 1 FROM user_emails
    WHERE email = v_email AND user_id != v_caller_id
  ) THEN
    RAISE EXCEPTION 'email_taken';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_emails
    WHERE email = v_email AND user_id = v_caller_id
  ) THEN
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
    UPDATE user_emails
    SET    verified_at = COALESCE(verified_at, NOW())
    WHERE  email   = v_email
      AND  user_id = v_caller_id
      AND  verified_at IS NULL;
  END IF;

  FOR v_cm IN
    SELECT id, user_id AS provisional_id, company_id
    FROM   company_memberships
    WHERE  invited_email      = v_email
      AND  onboarding_status != 'account_created'
      AND  status             = 'active'
  LOOP
    IF v_cm.provisional_id = v_caller_id THEN
      UPDATE company_memberships
      SET    onboarding_status = 'account_created',
             updated_at        = NOW()
      WHERE  id = v_cm.id;

    ELSIF EXISTS (
      SELECT 1 FROM company_memberships
      WHERE  user_id    = v_caller_id
        AND  company_id = v_cm.company_id
    ) THEN
      UPDATE company_memberships
      SET    onboarding_status = 'account_created',
             updated_at        = NOW()
      WHERE  user_id    = v_caller_id
        AND  company_id = v_cm.company_id;

      DELETE FROM company_memberships WHERE id = v_cm.id;

    ELSE
      UPDATE company_memberships
      SET    user_id           = v_caller_id,
             onboarding_status = 'account_created',
             updated_at        = NOW()
      WHERE  id = v_cm.id;
    END IF;

    v_linked := v_linked || v_cm.company_id;
  END LOOP;

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
