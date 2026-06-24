CREATE TYPE "public"."orientation_package_status" AS ENUM('published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."requalification_policy" AS ENUM('full', 'new_content_only', 'none');--> statement-breakpoint
CREATE TABLE "orientation_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text NOT NULL,
	"version" integer NOT NULL,
	"supersedes_id" text,
	"content_model_ref" jsonb NOT NULL,
	"quiz_ref" jsonb NOT NULL,
	"asset_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"requalification_policy" "requalification_policy" NOT NULL,
	"qa_flagged" boolean DEFAULT false NOT NULL,
	"status" "orientation_package_status" DEFAULT 'published' NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orientation_packages_site_id_version_unique" UNIQUE("site_id","version")
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "package_version" integer;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orientation_packages" ADD CONSTRAINT "orientation_packages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orientation_packages" ADD CONSTRAINT "orientation_packages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orientation_packages" ADD CONSTRAINT "orientation_packages_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- Step 5 setup (Feature2-Pipeline-Skeleton-Brief.md): orientation_packages RLS
-- per HowDesign-DataModel.md §4.1 ("Approve & publish a package | content_approver"),
-- and broaden who can write generation_jobs to include content_approver — the
-- approve action transitions the job (awaiting_approval -> publishing) via the
-- caller's own session, same pattern as Step 2's broadening for content_developer.

ALTER TABLE "orientation_packages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orientation_packages: read if org member" ON "orientation_packages"
  FOR SELECT USING (org_id IN (SELECT org_id FROM user_org_ids(auth.uid())));

CREATE POLICY "orientation_packages: write if content_approver" ON "orientation_packages"
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND roles && ARRAY['content_approver']::org_role[]
    )
  );

DROP POLICY "generation_jobs: write if client_admin or content_developer" ON "generation_jobs";

CREATE POLICY "generation_jobs: write if client_admin/dev/approver" ON "generation_jobs"
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND roles && ARRAY['client_admin', 'content_developer', 'content_approver']::org_role[]
    )
  );