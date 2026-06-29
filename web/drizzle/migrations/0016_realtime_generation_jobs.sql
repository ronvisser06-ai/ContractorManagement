-- Enable realtime updates for generation_jobs so the JobTracker component
-- receives live Postgres changes via the supabase_realtime publication.
-- Idempotent: skips if the table is already in the publication.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_publication_tables
    WHERE  pubname   = 'supabase_realtime'
      AND  tablename = 'generation_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE generation_jobs;
  END IF;
END
$$;
