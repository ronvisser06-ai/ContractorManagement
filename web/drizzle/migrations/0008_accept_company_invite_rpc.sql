-- M1 Step 3: SECURITY DEFINER RPC that atomically completes company registration.
-- Called via the admin client from registerFromCompanyInvite server action so that
-- it works whether Supabase email-confirmation is on (no active session) or off
-- (session present). p_user_id is passed explicitly rather than using auth.uid().
-- Security: token is a 64-char random hex string (unguessable); single-use (FOR UPDATE
-- lock + immediate status flip prevents double-accept races); p_user_id must already
-- have a matching public.users row (created by the handle_new_user trigger).

CREATE OR REPLACE FUNCTION public.accept_company_invite(
  p_token         text,
  p_user_id       uuid,
  p_membership_id text,
  p_legal_name    text
)
RETURNS text  -- returns company_id on success
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id  text;
  v_org_id      text;
  v_expires_at  timestamptz;
  v_inv_status  invitation_status;
BEGIN
  -- Lock the invitation row to prevent double-accept races.
  SELECT company_id, org_id, expires_at, status
  INTO   v_company_id, v_org_id, v_expires_at, v_inv_status
  FROM   public.invitations
  WHERE  token = p_token
    AND  type  = 'company'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invitation token';
  END IF;

  IF v_inv_status != 'pending' THEN
    RAISE EXCEPTION 'This invitation has already been used or revoked';
  END IF;

  IF v_expires_at < NOW() THEN
    RAISE EXCEPTION 'This invitation has expired';
  END IF;

  -- The users row is created by the handle_new_user trigger on auth signup.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User account not found — auth signup may not have completed yet';
  END IF;

  IF trim(p_legal_name) = '' THEN
    RAISE EXCEPTION 'Company name cannot be empty';
  END IF;

  -- Update the stub company row that was created in the Step 2 invite action.
  UPDATE public.contractor_companies
  SET    legal_name = trim(p_legal_name),
         updated_at = NOW()
  WHERE  id = v_company_id;

  -- Grant contractor_admin membership to the registrant.
  -- ON CONFLICT DO NOTHING makes this idempotent if the action is retried.
  INSERT INTO public.company_memberships (
    id, user_id, company_id, roles, onboarding_status, status, created_at, updated_at
  )
  VALUES (
    p_membership_id,
    p_user_id,
    v_company_id,
    ARRAY['contractor_admin']::public.company_role[],
    'account_created',
    'active',
    NOW(), NOW()
  )
  ON CONFLICT (user_id, company_id) DO NOTHING;

  -- Activate the client ↔ company relationship.
  UPDATE public.client_company_links
  SET    status      = 'active',
         accepted_at = NOW()
  WHERE  org_id      = v_org_id
    AND  company_id  = v_company_id
    AND  status      = 'invited';

  -- Consume the invitation so the token cannot be reused.
  UPDATE public.invitations
  SET    status           = 'accepted',
         accepted_user_id = p_user_id,
         accepted_at      = NOW()
  WHERE  token = p_token;

  RETURN v_company_id;
END;
$$;
