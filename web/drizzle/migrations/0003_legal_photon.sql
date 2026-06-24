CREATE TYPE "public"."job_status" AS ENUM('queued', 'extracting', 'structuring', 'generating_quiz', 'qa_review', 'awaiting_approval', 'publishing', 'published', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"current_stage" "job_status" DEFAULT 'queued' NOT NULL,
	"rework_count" integer DEFAULT 0 NOT NULL,
	"max_rework" integer DEFAULT 3 NOT NULL,
	"qa_flagged" boolean DEFAULT false NOT NULL,
	"package_id" text,
	"artifacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"qa_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"telemetry" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "generation_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── RLS: client domain, isolated by org_id (HowDesign-DataModel.md §3.2/§4.1) ──
ALTER TABLE "generation_jobs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generation_jobs: read if org member" ON "generation_jobs"
  FOR SELECT USING (org_id IN (SELECT org_id FROM user_org_ids(auth.uid())));

CREATE POLICY "generation_jobs: write if content_developer" ON "generation_jobs"
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND 'content_developer' = ANY(roles)
    )
  );