-- Step 2 setup (Feature2-Pipeline-Skeleton-Brief.md): broaden who can create a
-- job, turn on Realtime for the tracker UI, and create the artifacts bucket.

-- HowDesign-DataModel.md §4.1 names content_developer only for job writes, but
-- client_admin is the only role obtainable today (no invite/role-assignment
-- flow until M1), and the Step 2 brief explicitly names both roles as able to
-- trigger a generation job. Revisit once M1's invite flow can grant
-- content_developer directly.
DROP POLICY "generation_jobs: write if content_developer" ON "generation_jobs";

CREATE POLICY "generation_jobs: write if client_admin or content_developer" ON "generation_jobs"
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND roles && ARRAY['client_admin', 'content_developer']::org_role[]
    )
  );

-- Stage-tracker UI subscribes to row changes here. RLS still applies per
-- subscriber, so a tenant only ever receives events for their own jobs.
ALTER PUBLICATION supabase_realtime ADD TABLE generation_jobs;

-- Private bucket for canned pipeline artifacts (Step 2 stubs now, the real
-- Python extractor's output in Step 3). Only the service role touches it from
-- the Inngest workflow, so no public access or object policies are needed.
INSERT INTO storage.buckets (id, name, public)
VALUES ('pipeline-artifacts', 'pipeline-artifacts', false)
ON CONFLICT (id) DO NOTHING;
