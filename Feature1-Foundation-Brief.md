# Feature 1 — Foundation Slice (Plan-Mode Brief)

> **Milestone:** M0 (Foundations & Walking Skeleton). **This is ONE feature, not all of M0** (Rule 6). Hand this brief to Claude Code and start with *"Jacques, let's build Feature 1."* Build in Plan Mode first; only then Act Mode.

---

## The three questions (locked — Rule 1)

1. **What:** Email/password auth + the six-role RBAC scaffold + a role-aware empty app shell, **plus** a Client Admin can create their organization and add a site, persisted with tenant-isolating RLS.
2. **Who:** The Client Admin — first user into the system; establishes the auth all roles share.
3. **Done:** Deployed to staging; you can register → log in → create an org → add a site → refresh and see it persisted; **a test proves a second tenant cannot see the first tenant's org/sites.**

## In scope / out of scope

**In:** auth (register, login, session, logout); `users` profile creation on signup; create organization (creator becomes `client_admin`); create + list sites; role-aware empty dashboard shell; RLS on all four tables; the cross-tenant isolation test.

**Out (do NOT build yet):** contractor companies/workers, invitations, the generation pipeline / Inngest jobs, the renderer, QR, foreman/PWA, dashboards beyond an empty shell, SMS, `user_emails` reconciliation (single primary email is fine for now), crew activation, lockout.

---

## Tech (locked — CLAUDE.md §3)

Next.js 14 App Router + TS (strict) · Tailwind + shadcn/ui · Supabase (Postgres + Auth) · Drizzle · Vercel · Sentry. *(Inngest, Resend, Python extractor, Anthropic come in later features.)*

---

## Architecture map

### Tables (subset of HowDesign-DataModel.md — only what this feature needs)

- **users** — `id uuid PK = auth.uid()`, `given_name`, `family_name`, `primary_email citext`, `mobile text?`, `status enum(active,disabled)`, `created_at/updated_at`.
- **organizations** — `id ULID org_ PK`, `name`, `status enum(active,suspended)`, `settings jsonb`, `created_at/updated_at`.
- **sites** — `id ULID site_ PK`, `org_id FK organizations`, `name`, `address jsonb?`, `province text?`, `orientation_validity_months int?`, `active_package_id ULID? (null for now)`, `created_at/updated_at`.
- **org_memberships** — `id ULID PK`, `user_id FK users`, `org_id FK organizations`, `roles enum[] org_role(client_admin,content_developer,content_approver,foreman)`, `status enum(invited,active,disabled)`, `created_at`, unique `(user_id, org_id)`.

### Access (RLS — ship policies in the same migration)

- Helper `user_org_ids(uid)` → orgs where the user has an active `org_memberships` row.
- `organizations`: read if `id ∈ user_org_ids(auth.uid())`; insert allowed for any authenticated user (creating a new org); update if caller is `client_admin` of the row.
- `sites`: read if `org_id ∈ user_org_ids`; write if caller is `client_admin` of `org_id`.
- `org_memberships`: read own rows + rows in the caller's orgs; the creating user's `client_admin` row is inserted at org-creation time (service path).
- `users`: read self; update self.

### Auth flow

Register → Supabase Auth user created → create `users` row (`id = auth uid`, names, primary_email). "Create organization" → insert `organizations` + `org_memberships(user, org, roles=[client_admin], status=active)`. Then sites CRUD is gated to that org.

### Routes / screens

`/register`, `/login` (Supabase auth) · `/onboarding/create-org` (shown when the user has no org) · `/app` role-aware empty dashboard shell · `/app/sites` (list + create site). Use server actions or route handlers; keep it thin.

---

## Build order (one small step → test in browser → commit; Rules 7 & 9)

1. Scaffold Next.js + Tailwind + shadcn; deploy a hello page to Vercel; wire Sentry. **Commit.**
2. Supabase project + Drizzle; first migration = the four tables + enums (no RLS yet). **Commit.**
3. Auth: register / login / logout / session; create `users` profile on signup. Test. **Commit.**
4. RLS: helper + policies on all four tables; write the **two-tenant isolation test**. Test. **Commit.**
5. Create organization → `client_admin` membership. Test. **Commit.**
6. Sites: create + list, scoped to the org. Test. **Commit.**
7. Role-aware empty dashboard shell. Test. Deploy to staging. **Commit.**

## Definition of Done

All acceptance criteria met, the cross-tenant test passes, lint + tests green, deployed to staging, and **BUILDLOG.md updated** (Rule 19). Then `Jacques, ship check` → ship → `Jacques, what's next` for Feature 2 (the stubbed job skeleton + fixed renderer).

---

## Getting the repo set up

1. Create a new git repo (e.g. `contractor-orientation`).
2. Copy into it: **CLAUDE.md** (root), plus `JACQUES.md`, `JACQUES_QUICK_START.md`, `BUILDLOG.md`, and a `/docs` folder holding FunctionalOverview.md, ExecutionPlan.md, HowDesign-DataModel.md, HowDesign-QRVerification.md, orientation_pipeline_contracts_v0.1.md, DesignRationalization.md, and this brief.
3. Open in Claude Code and say: **"Jacques, let's build Feature 1."**
