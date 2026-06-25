CREATE TYPE "public"."assignment_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."company_role" AS ENUM('contractor_admin', 'worker');--> statement-breakpoint
CREATE TYPE "public"."invitation_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."invitation_type" AS ENUM('company', 'worker', 'org_user');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."onboarding_status" AS ENUM('entered', 'invited', 'logged_in', 'account_created');--> statement-breakpoint
CREATE TABLE "client_company_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"company_id" text NOT NULL,
	"status" "link_status" DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_company_links_org_id_company_id_unique" UNIQUE("org_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" text NOT NULL,
	"roles" "company_role"[] DEFAULT '{}' NOT NULL,
	"contractor_ref" text,
	"onboarding_status" "onboarding_status" DEFAULT 'entered' NOT NULL,
	"invited_email" "citext",
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_memberships_user_id_company_id_unique" UNIQUE("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "contractor_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"trade_types" text[] DEFAULT '{}' NOT NULL,
	"contact_name" text,
	"contact_email" "citext",
	"contact_phone" text,
	"logo_asset_id" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "invitation_type" NOT NULL,
	"token" text NOT NULL,
	"channel" "invitation_channel" DEFAULT 'email' NOT NULL,
	"email" "citext",
	"phone" text,
	"org_id" text,
	"company_id" text,
	"intended_roles" text[] DEFAULT '{}' NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"accepted_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "site_company_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"company_id" text NOT NULL,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_company_assignments_site_id_company_id_unique" UNIQUE("site_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "site_worker_activations" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"company_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"activated_by" uuid NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_worker_activations_site_id_user_id_unique" UNIQUE("site_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_emails_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "client_company_links" ADD CONSTRAINT "client_company_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_company_links" ADD CONSTRAINT "client_company_links_company_id_contractor_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contractor_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_contractor_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contractor_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_contractor_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contractor_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_company_assignments" ADD CONSTRAINT "site_company_assignments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_company_assignments" ADD CONSTRAINT "site_company_assignments_company_id_contractor_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contractor_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_worker_activations" ADD CONSTRAINT "site_worker_activations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_worker_activations" ADD CONSTRAINT "site_worker_activations_company_id_contractor_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."contractor_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_worker_activations" ADD CONSTRAINT "site_worker_activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_worker_activations" ADD CONSTRAINT "site_worker_activations_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_emails" ADD CONSTRAINT "user_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- ── RLS: enable on all M1 tables ─────────────────────────────────────────────
ALTER TABLE "contractor_companies"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_memberships"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_emails"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_company_links"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_company_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_worker_activations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations"             ENABLE ROW LEVEL SECURITY;

-- ── Covering indexes (HowDesign-DataModel.md §6) ──────────────────────────────
-- The unique constraints on (user_id, company_id) and (org_id, company_id) already
-- create btree indexes usable for left-prefix lookups. Add the right-prefix
-- indexes that the helper functions need for the reverse direction.
CREATE INDEX IF NOT EXISTS "company_memberships_company_id_idx"
  ON "company_memberships" ("company_id");

CREATE INDEX IF NOT EXISTS "client_company_links_company_id_idx"
  ON "client_company_links" ("company_id");

-- ── Helper functions (relationship-derived RLS, HowDesign-DataModel.md §4) ────
-- Returns the set of company_ids where the caller has any active membership.
CREATE OR REPLACE FUNCTION user_company_ids(uid uuid)
RETURNS TABLE(company_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM company_memberships
  WHERE user_id = uid AND status = 'active'
$$;

-- Returns orgs linked (via an active client_company_link) to any of the
-- caller's companies. Lets contractor-side users discover their linked clients.
CREATE OR REPLACE FUNCTION user_linked_org_ids(uid uuid)
RETURNS TABLE(org_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ccl.org_id
  FROM client_company_links ccl
  WHERE ccl.company_id IN (SELECT company_id FROM user_company_ids(uid))
    AND ccl.status = 'active'
$$;

-- Returns companies linked (via an active client_company_link) to any of the
-- caller's orgs. Lets client-side users discover their linked contractors.
CREATE OR REPLACE FUNCTION org_linked_company_ids(uid uuid)
RETURNS TABLE(company_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ccl.company_id
  FROM client_company_links ccl
  WHERE ccl.org_id IN (SELECT org_id FROM user_org_ids(uid))
    AND ccl.status = 'active'
$$;

-- ── contractor_companies ──────────────────────────────────────────────────────
-- Readable by own members and by linked clients (the sliced view at the app layer).
-- Inserts come only from service-role RPCs (company registration, Step 3).
CREATE POLICY "contractor_companies: read if member or linked" ON "contractor_companies"
  FOR SELECT USING (
    id IN (SELECT company_id FROM user_company_ids(auth.uid()))
    OR id IN (SELECT company_id FROM org_linked_company_ids(auth.uid()))
  );

CREATE POLICY "contractor_companies: update if contractor_admin" ON "contractor_companies"
  FOR UPDATE USING (
    id IN (
      SELECT company_id FROM company_memberships
      WHERE user_id = auth.uid() AND status = 'active'
        AND 'contractor_admin' = ANY(roles)
    )
  );

-- ── company_memberships ───────────────────────────────────────────────────────
-- Readable by members of the same company and by linked client orgs.
-- contractor_admin writes for their own company.
CREATE POLICY "company_memberships: read if member or linked" ON "company_memberships"
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM user_company_ids(auth.uid()))
    OR company_id IN (SELECT company_id FROM org_linked_company_ids(auth.uid()))
  );

CREATE POLICY "company_memberships: insert if contractor_admin" ON "company_memberships"
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT cm.company_id FROM company_memberships cm
      WHERE cm.user_id = auth.uid() AND cm.status = 'active'
        AND 'contractor_admin' = ANY(cm.roles)
    )
  );

CREATE POLICY "company_memberships: update if contractor_admin" ON "company_memberships"
  FOR UPDATE USING (
    company_id IN (
      SELECT cm.company_id FROM company_memberships cm
      WHERE cm.user_id = auth.uid() AND cm.status = 'active'
        AND 'contractor_admin' = ANY(cm.roles)
    )
  );

-- ── user_emails ───────────────────────────────────────────────────────────────
-- Own rows always readable; company admins can read their members' emails.
-- Client-org access to worker emails goes through site activation (bridge domain,
-- deferred until completions/QR tables exist in M3).
CREATE POLICY "user_emails: read own or company admin" ON "user_emails"
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IN (
      SELECT cm.user_id FROM company_memberships cm
      WHERE cm.company_id IN (SELECT company_id FROM user_company_ids(auth.uid()))
        AND cm.status = 'active'
    )
  );

CREATE POLICY "user_emails: insert own" ON "user_emails"
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_emails: update own" ON "user_emails"
  FOR UPDATE USING (user_id = auth.uid());

-- ── client_company_links ──────────────────────────────────────────────────────
-- Both sides of the relationship can see the link.
-- client_admin can create and update links for their org.
CREATE POLICY "client_company_links: read if org or company" ON "client_company_links"
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM user_org_ids(auth.uid()))
    OR company_id IN (SELECT company_id FROM user_company_ids(auth.uid()))
  );

CREATE POLICY "client_company_links: insert if client_admin" ON "client_company_links"
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid() AND status = 'active'
        AND 'client_admin' = ANY(roles)
    )
  );

CREATE POLICY "client_company_links: update if client_admin" ON "client_company_links"
  FOR UPDATE USING (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid() AND status = 'active'
        AND 'client_admin' = ANY(roles)
    )
  );

-- ── site_company_assignments ──────────────────────────────────────────────────
-- Org members (their sites) and company members can see assignments.
-- client_admin writes for sites belonging to their org.
CREATE POLICY "site_company_asgn: read if org or company" ON "site_company_assignments"
  FOR SELECT USING (
    site_id IN (
      SELECT s.id FROM sites s
      WHERE s.org_id IN (SELECT org_id FROM user_org_ids(auth.uid()))
    )
    OR company_id IN (SELECT company_id FROM user_company_ids(auth.uid()))
  );

CREATE POLICY "site_company_asgn: write if client_admin" ON "site_company_assignments"
  FOR ALL USING (
    site_id IN (
      SELECT s.id FROM sites s
      WHERE s.org_id IN (
        SELECT org_id FROM org_memberships
        WHERE user_id = auth.uid() AND status = 'active'
          AND 'client_admin' = ANY(roles)
      )
    )
  );

-- ── site_worker_activations ───────────────────────────────────────────────────
-- Visible to the worker, their company members, and the site's org members.
-- contractor_admin writes for their company.
CREATE POLICY "site_worker_act: read if org, company, or self" ON "site_worker_activations"
  FOR SELECT USING (
    user_id = auth.uid()
    OR site_id IN (
      SELECT s.id FROM sites s
      WHERE s.org_id IN (SELECT org_id FROM user_org_ids(auth.uid()))
    )
    OR company_id IN (SELECT company_id FROM user_company_ids(auth.uid()))
  );

CREATE POLICY "site_worker_act: write if contractor_admin" ON "site_worker_activations"
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM company_memberships
      WHERE user_id = auth.uid() AND status = 'active'
        AND 'contractor_admin' = ANY(roles)
    )
  );

-- ── invitations ───────────────────────────────────────────────────────────────
-- Creator, accepting user, and org/company members can see invitations.
-- client_admin invites companies/org_users; contractor_admin invites workers.
CREATE POLICY "invitations: read if creator or involved" ON "invitations"
  FOR SELECT USING (
    created_by = auth.uid()
    OR accepted_user_id = auth.uid()
    OR org_id IN (SELECT org_id FROM user_org_ids(auth.uid()))
    OR company_id IN (SELECT company_id FROM user_company_ids(auth.uid()))
  );

CREATE POLICY "invitations: insert if admin" ON "invitations"
  FOR INSERT WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id IN (
        SELECT org_id FROM org_memberships
        WHERE user_id = auth.uid() AND status = 'active'
          AND 'client_admin' = ANY(roles)
      )
    )
    OR (
      company_id IS NOT NULL
      AND company_id IN (
        SELECT company_id FROM company_memberships
        WHERE user_id = auth.uid() AND status = 'active'
          AND 'contractor_admin' = ANY(roles)
      )
    )
  );

CREATE POLICY "invitations: update if admin" ON "invitations"
  FOR UPDATE USING (
    (
      org_id IS NOT NULL
      AND org_id IN (
        SELECT org_id FROM org_memberships
        WHERE user_id = auth.uid() AND status = 'active'
          AND 'client_admin' = ANY(roles)
      )
    )
    OR (
      company_id IS NOT NULL
      AND company_id IN (
        SELECT company_id FROM company_memberships
        WHERE user_id = auth.uid() AND status = 'active'
          AND 'contractor_admin' = ANY(roles)
      )
    )
  );