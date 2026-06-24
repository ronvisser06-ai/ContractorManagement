-- citext must exist before the users table is created (primary_email column)
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('client_admin', 'content_developer', 'content_approver', 'foreman');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"roles" "org_role"[] DEFAULT '{}' NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_memberships_user_id_org_id_unique" UNIQUE("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"address" jsonb,
	"province" text,
	"orientation_validity_months" integer,
	"active_package_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"given_name" text NOT NULL,
	"family_name" text NOT NULL,
	"primary_email" "citext" NOT NULL,
	"mobile" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── RLS: enable on all four tables ───────────────────────────────────────────
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_memberships" ENABLE ROW LEVEL SECURITY;

-- ── Helper function ───────────────────────────────────────────────────────────
-- Returns the set of org_ids where the given user has an active membership.
-- SECURITY DEFINER so it runs as the function owner and bypasses table RLS,
-- preventing infinite recursion from the org_memberships policy.
-- Full verification of auth.uid() context waits for Step 3 (auth wiring).
CREATE OR REPLACE FUNCTION user_org_ids(uid uuid)
RETURNS TABLE(org_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_memberships
  WHERE user_id = uid AND status = 'active'
$$;

-- ── users ─────────────────────────────────────────────────────────────────────
-- Workers read/write their own row only; service role writes on signup.
CREATE POLICY "users: read own row" ON "users"
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "users: update own row" ON "users"
  FOR UPDATE USING (id = auth.uid());

-- ── organizations ─────────────────────────────────────────────────────────────
-- Any authenticated user may create an org (they become client_admin in the same tx).
CREATE POLICY "orgs: read if member" ON "organizations"
  FOR SELECT USING (id IN (SELECT org_id FROM user_org_ids(auth.uid())));

CREATE POLICY "orgs: insert if authenticated" ON "organizations"
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "orgs: update if client_admin" ON "organizations"
  FOR UPDATE USING (
    id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND 'client_admin' = ANY(roles)
    )
  );

-- ── sites ─────────────────────────────────────────────────────────────────────
CREATE POLICY "sites: read if org member" ON "sites"
  FOR SELECT USING (org_id IN (SELECT org_id FROM user_org_ids(auth.uid())));

CREATE POLICY "sites: write if client_admin" ON "sites"
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND 'client_admin' = ANY(roles)
    )
  );

-- ── org_memberships ───────────────────────────────────────────────────────────
-- A user may read their own rows and any row belonging to orgs they are in.
-- Inserts come from the service role (signup handler, Step 3).
CREATE POLICY "memberships: read own or same org" ON "org_memberships"
  FOR SELECT USING (
    user_id = auth.uid()
    OR org_id IN (SELECT org_id FROM user_org_ids(auth.uid()))
  );
