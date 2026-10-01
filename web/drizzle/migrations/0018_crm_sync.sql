-- Outbound sync queue to Relatrix CRM (Relatrix-Integration-Brief.md §4, slice S1).
--
-- One row per wanted state of one ConTrak entity: "this company should exist in Relatrix like this". The ConTrak
-- action that changes the entity queues it (enqueue_crm_sync) in the same breath and never waits for Relatrix; a
-- worker (Inngest) drains it with backoff. A failed sync is therefore visible, retried or abandoned loudly, and never
-- blocks the user.
--
-- SERVICE ROLE ONLY. The table has RLS enabled and NO policy, and every privilege is revoked from anon and authenticated,
-- so no browser session can read or write it; the three functions are granted to service_role alone. The payload is
-- company-level data only (the brief's "never crosses" list): no worker, no contact, no credential.

CREATE TABLE crm_sync (
  id               text PRIMARY KEY,
  entity           text NOT NULL CHECK (entity IN ('contractor_company', 'client_org', 'client_company_link')),
  entity_id        text NOT NULL,
  op               text NOT NULL,
  payload          jsonb NOT NULL,
  payload_hash     text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'delivering', 'delivered', 'blocked', 'abandoned', 'dry_run')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  lease_until      timestamptz,
  last_error       text CHECK (char_length(last_error) <= 500),
  last_status      integer,
  delivered_hash   text,
  delivered_at     timestamptz,
  remote_id        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity, entity_id, op)
);

CREATE INDEX crm_sync_due_idx ON crm_sync (next_attempt_at) WHERE status IN ('pending', 'blocked', 'dry_run', 'delivering');

ALTER TABLE crm_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_sync FROM anon, authenticated, public;

-- ── queue ─────────────────────────────────────────────────────────────────────────────────────────────
-- The same wanted state is not queued twice, whatever its status (a delivered one stays delivered; an abandoned one
-- stays abandoned until a person retries it). A CHANGED state replaces the payload and goes round again.
CREATE OR REPLACE FUNCTION enqueue_crm_sync(p_entity text, p_entity_id text, p_op text, p_payload jsonb, p_hash text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed boolean;
BEGIN
  INSERT INTO crm_sync (id, entity, entity_id, op, payload, payload_hash)
  VALUES ('crm_' || replace(gen_random_uuid()::text, '-', ''), p_entity, p_entity_id, p_op, p_payload, p_hash)
  ON CONFLICT (entity, entity_id, op) DO UPDATE
    SET payload = EXCLUDED.payload,
        payload_hash = EXCLUDED.payload_hash,
        status = 'pending',
        attempts = 0,
        next_attempt_at = now(),
        lease_until = NULL,
        last_error = NULL,
        last_status = NULL,
        updated_at = now()
    WHERE crm_sync.payload_hash IS DISTINCT FROM EXCLUDED.payload_hash
  RETURNING true INTO v_changed;
  RETURN CASE WHEN v_changed THEN 'queued' ELSE 'unchanged' END;
END $$;

-- ── claim ─────────────────────────────────────────────────────────────────────────────────────────────
-- Takes due rows under a lease, skipping any another worker has locked, so two workers never take the same row.
-- A row whose lease ran out (a worker died mid-send) is taken again: that attempt counts, and the resend is safe
-- because every attempt carries the same Idempotency-Key. A dry-run row is taken again only when p_include_dry.
CREATE OR REPLACE FUNCTION claim_crm_sync(p_limit integer, p_lease_seconds integer, p_include_dry boolean)
RETURNS SETOF crm_sync
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE crm_sync c
     SET status = 'delivering',
         lease_until = now() + make_interval(secs => p_lease_seconds),
         attempts = c.attempts + 1,
         updated_at = now()
   WHERE c.id IN (
     SELECT id FROM crm_sync
      WHERE next_attempt_at <= now()
        AND (status IN ('pending', 'blocked')
             OR (p_include_dry AND status = 'dry_run')
             OR (status = 'delivering' AND lease_until < now()))
      ORDER BY next_attempt_at, created_at
      LIMIT greatest(p_limit, 0)
      FOR UPDATE SKIP LOCKED)
  RETURNING c.*
$$;

-- ── finish ────────────────────────────────────────────────────────────────────────────────────────────
-- Records what happened to one attempt. Only a row still being delivered, and still for the SAME wanted state, is
-- updated by the outcome: if the state changed while it was being sent, the old outcome must not mark the new state
-- delivered, so the row simply goes round again.
CREATE OR REPLACE FUNCTION finish_crm_sync(
  p_id text, p_hash text, p_outcome text, p_status integer, p_error text, p_remote text, p_delay_seconds integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v crm_sync;
BEGIN
  IF p_outcome NOT IN ('delivered', 'retry', 'blocked', 'abandoned', 'dry_run') THEN
    RAISE EXCEPTION 'unknown outcome' USING errcode = '22023';
  END IF;

  SELECT * INTO v FROM crm_sync WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.status <> 'delivering' THEN RETURN; END IF;

  IF v.payload_hash <> p_hash THEN
    UPDATE crm_sync SET status = 'pending', attempts = 0, next_attempt_at = now(), lease_until = NULL, updated_at = now() WHERE id = p_id;
    RETURN;
  END IF;

  UPDATE crm_sync SET
    status = CASE p_outcome WHEN 'retry' THEN 'pending' WHEN 'delivered' THEN 'delivered' ELSE p_outcome END,
    -- A blocked sync (a key or scope a person must fix) does not use up attempts.
    attempts = CASE WHEN p_outcome = 'blocked' THEN greatest(attempts - 1, 0) ELSE attempts END,
    next_attempt_at = CASE WHEN p_outcome IN ('retry', 'blocked') THEN now() + make_interval(secs => greatest(p_delay_seconds, 0)) ELSE next_attempt_at END,
    lease_until = NULL,
    last_error = left(p_error, 500),
    last_status = p_status,
    delivered_hash = CASE WHEN p_outcome = 'delivered' THEN p_hash ELSE delivered_hash END,
    delivered_at = CASE WHEN p_outcome = 'delivered' THEN now() ELSE delivered_at END,
    remote_id = CASE WHEN p_outcome = 'delivered' THEN p_remote ELSE remote_id END,
    updated_at = now()
  WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION enqueue_crm_sync(text, text, text, jsonb, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION claim_crm_sync(integer, integer, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION finish_crm_sync(text, text, text, integer, text, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_crm_sync(text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION claim_crm_sync(integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION finish_crm_sync(text, text, text, integer, text, text, integer) TO service_role;
