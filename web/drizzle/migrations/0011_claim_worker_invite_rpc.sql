-- M1 Step 4b: SECURITY DEFINER RPC that atomically consumes a worker invite token.
--
-- Called via the admin client from the registration server action.
-- FOR UPDATE lock on the invitation row prevents double-accept races.
--
-- Merge path (p_claiming_user_id != p_provisional_user_id): re-points the
-- company_memberships row to the existing identity and handles the edge case
-- where the existing user is already a member (deletes the duplicate provisional row).
--
-- Normal claim path (p_claiming_user_id == p_provisional_user_id): advances
-- onboarding_status and consumes the invitation — no membership re-pointing needed.

CREATE OR REPLACE FUNCTION public.claim_worker_invite(
  p_token               text,
  p_claiming_user_id    uuid,   -- the user who ends up owning the membership
  p_provisional_user_id uuid    -- the stub user created in step 4a
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id  text;
  v_expires_at  timestamptz;
  v_inv_status  invitation_status;
BEGIN
  -- Lock the invitation row to prevent double-accept races.
  SELECT company_id, expires_at, status
  INTO   v_company_id, v_expires_at, v_inv_status
  FROM   public.invitations
  WHERE  token = p_token AND type = 'worker'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  IF v_inv_status != 'pending' THEN
    RAISE EXCEPTION 'already_used';
  END IF;

  IF v_expires_at < NOW() THEN
    RAISE EXCEPTION 'expired';
  END IF;

  -- Merge path: re-point the provisional membership to the existing identity.
  IF p_claiming_user_id != p_provisional_user_id THEN
    IF EXISTS (
      SELECT 1 FROM public.company_memberships
      WHERE user_id = p_claiming_user_id AND company_id = v_company_id
    ) THEN
      -- Existing user is already a member of this company — delete the duplicate
      -- provisional row so we don't end up with two memberships.
      DELETE FROM public.company_memberships
      WHERE user_id = p_provisional_user_id AND company_id = v_company_id;
    ELSE
      -- Re-point the provisional membership to the existing identity.
      UPDATE public.company_memberships
      SET    user_id    = p_claiming_user_id,
             updated_at = NOW()
      WHERE  user_id    = p_provisional_user_id
        AND  company_id = v_company_id;
    END IF;
  END IF;

  -- Advance the lifecycle for the claiming user.
  UPDATE public.company_memberships
  SET    onboarding_status = 'account_created',
         updated_at        = NOW()
  WHERE  user_id    = p_claiming_user_id
    AND  company_id = v_company_id;

  -- Consume the invitation — single-use, cannot be replayed.
  UPDATE public.invitations
  SET    status           = 'accepted',
         accepted_user_id = p_claiming_user_id,
         accepted_at      = NOW()
  WHERE  token = p_token;
END;
$$;
