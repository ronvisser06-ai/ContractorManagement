# Build Log — Contractor Orientation Management

After each development session, record:
1. **What I built today**
2. **What went wrong and how I fixed it**
3. **What I want to build next**

This tracks progress and lets you pick up exactly where you left off (Rule 19).

---

## Session Template

```markdown
### Session [Date] — [Feature Name]

**What I Built**:
- [Feature description]
- [Commits made]

**What Went Wrong**:
- [Issue]: [How fixed]
- [Learnings]

**What's Next**:
- [Next single feature]
- [Dependencies/blockers]

**Rules Followed**:
- ✓ Planned before coding (Rules 1, 2)
- ✓ One feature at a time (Rule 6)
- ✓ Tested after changes (Rule 7)
- ✓ Committed to git (Rule 9)

**Context Usage**: [X]% — [Fresh / Compact / Fresh conversation]
```

---

## Session Entries

### Session 2026-06-23 — Design Phase Complete

**What I Built** (design, not code):
- Locked the "What": FunctionalOverview.md (six roles, one-orientation-per-site, worker-centric single QR, crew activation, SMS/kiosk, lockout, requalification).
- Locked the "How": ExecutionPlan.md (milestones M0–M5, locked stack, AI-agent roadmap), HowDesign-DataModel.md (three-domain schema + RLS + identity), HowDesign-QRVerification.md (worker-centric verification), orientation_pipeline_contracts_v0.1.md (pipeline contracts + §7 bounded editor).
- Ran a design-rationalization deep dive (DesignRationalization.md) and folded all decisions back in.
- Installed the Jacques coaching system in this project (CLAUDE.md tailored, JACQUES.md, JACQUES_QUICK_START.md, SETUP.md, this BUILDLOG).

**What Went Wrong**:
- Nothing — design phase. Two prior decisions were deliberately revised in the deep dive (per-site QR → per-worker; company-only site association → + crew activation).

**What's Next**:
- **M0 — Foundations & Walking Skeleton.** First single feature to scope with Jacques (likely: project scaffold + Supabase auth + one role-protected page), then build outward to core schema + RLS and the stubbed job pipeline.
- Decide where code lives (Claude Code on the repo vs. here) and stand up the git repo.

**Rules Followed**:
- ✓ Thought before prompting; planned thoroughly before any code (Rules 1, 2)
- ✓ Tech stack decided upfront (Rule 5)
- ✓ Constraints written down (Rule 12)

**Context Usage**: Fresh — ready to start M0 in a focused conversation.

### Session 2026-06-24 — M0 / Feature 1, Step 1 — Scaffold + Deploy

**What I Built**:
- Scaffolded Next.js 14 (App Router) + TypeScript strict + Tailwind + shadcn/ui into `web/`.
- Local dev build clean; TypeScript strict compile clean.
- Committed both the scaffold and root doc updates, pushed to GitHub (`ronvisser06-ai/ContractorManagement`, private).
- Deployed live on Vercel — production build green.

**What Went Wrong**:
- **Vercel 404 (Root Directory)**: Vercel defaulted to the repo root; fixed by setting Root Directory to `web` in project settings.
- **Case mismatch**: Vercel resolved the folder as `Web` (capital W) — fixed by correcting the Root Directory to exact lowercase `web`.
- **Framework Preset defaulting to "Other"**: With the wrong root Vercel couldn't detect Next.js; fixed automatically once Root Directory was correct and preset set to Next.js.

**What's Next**:
- **Step 2 — Supabase + Drizzle + four-table migration with RLS**: stand up the DB connection, write the core schema (orgs, sites, users, orientations), add RLS policies, run the migration against Supabase.
- Sentry integration deferred to a quick micro-step (not blocking Step 2).

**Rules Followed**:
- ✓ Planned before coding (Rules 1, 2)
- ✓ One feature at a time (Rule 6)
- ✓ Tested in browser — local + production (Rule 7)
- ✓ Committed and pushed to git (Rule 9)

**Context Usage**: Fresh — starting Step 2 in a new focused conversation.

### Session 2026-06-24 — M0 / Feature 1, Step 2 — Supabase + Drizzle + Schema + RLS

**What I Built**:
- Installed `drizzle-orm`, `drizzle-kit`, `postgres`, `@supabase/supabase-js`, `@supabase/ssr`, `ulid`, `dotenv`.
- Drizzle schema for the four foundation tables: `users` (uuid PK = auth.uid), `organizations`, `sites`, `org_memberships` — with four enums (`user_status`, `org_status`, `org_role`, `membership_status`) and `citext` on `primary_email`.
- Migration `0000_premium_pretty_boy.sql`: citext extension, DDL for all four tables, RLS enabled on all four, `user_org_ids(uid)` SECURITY DEFINER helper, seven RLS policies.
- `drizzle.config.ts`, `db:generate` / `db:migrate` / `db:studio` npm scripts, `newId(prefix)` ULID utility.
- `/api/health` smoke test: confirmed all four tables present and RLS enabled.
- Migration applied to Supabase via the session-mode pooler.

**What Went Wrong**:
- **Direct DB host unreachable**: `db.[ref].supabase.co` resolves only to an IPv6 address; the Claude Code sandbox has no IPv6 routing to the internet. Fixed by switching `DATABASE_URL` to the Supabase shared pooler (`aws-1-ca-central-1.pooler.supabase.com:5432`).
- **Duplicate key in `.env.local`**: copy-paste error wrote `NEXT_PUBLIC_SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL=…`; corrected manually.
- **Special chars in DB password**: `!`, `&`, `^` in the password must be URL-encoded (`%21`, `%26`, `%5E`) in the connection string; fixed in `.env.local`.

**What's Next**:
- **Step 3 — Auth**: register / login / logout / session; `handle_new_user` trigger; protected `/app` page; RLS isolation test.

**Rules Followed**:
- ✓ Read design docs before writing schema (Rules 1, 2)
- ✓ One feature at a time (Rule 6)
- ✓ Smoke-tested via `/api/health` (Rule 7)
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Same conversation as Step 1 — compact before Step 3.

### Session 2026-06-24 — M0 / Feature 1, Step 3 — Auth + Users Trigger + Protected /app

**What I Built**:
- Supabase SSR wiring: `createBrowserClient` (`src/lib/supabase/client.ts`), async `createServerClient` (`src/lib/supabase/server.ts`), middleware that refreshes the session cookie on every request and guards `/app` → `/login` (unauthenticated) and `/login|/register` → `/app` (already authenticated).
- Postgres `SECURITY DEFINER` trigger `handle_new_user` on `auth.users` — auto-creates `public.users` profile row on signup, reading `given_name` and `family_name` from `raw_user_meta_data`. Applied as migration `0001_auth_trigger.sql`.
- Register page (`/register`): given name, family name, email, password; handles email-confirmation-required state ("check your email").
- Login page (`/login`) and `logout` server action.
- Protected `/app` page: reads profile via Supabase client (anon key + user JWT, so RLS is enforced); shows name/email + live RLS check — `SELECT * FROM users` returns exactly 1 row (own row only).
- shadcn `Input` and `Label` UI primitives added.
- TypeScript strict: zero errors across all new files.

**What Went Wrong**:
- Nothing broke. One cold-start false alarm: first curl to `/login` returned 500 due to dev-server startup lag; resolved after warmup.

**What's Next**:
- **Step 4 — RLS tightening + two-tenant isolation test**: write the automated cross-tenant test (second user cannot read first user's org/sites); harden any policy gaps found.
- **Step 5 — Create org → client_admin membership**: org creation form, service-role insert of org + membership in one transaction.

**Rules Followed**:
- ✓ Read design docs + Next.js 16 dist/docs before writing framework code (Rules 1, 2)
- ✓ One feature at a time (Rule 6)
- ✓ Tested register → refresh → logout in browser (Rule 7)
- ✓ TypeScript strict clean before commit (Rule 7)
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Same conversation — compact or fresh conversation before Step 4.

### Session 2026-06-24 — M0 / Feature 1, Step 4 — Org Creation + Client Admin Membership

**What I Built**:
- Migration `0002_create_org_rpc.sql`: `create_organization(p_org_id, p_org_name, p_membership_id)` — SECURITY DEFINER Postgres function that inserts `organizations` + `org_memberships(roles=[client_admin], status=active)` atomically in one transaction. Guards: `auth.uid() IS NULL` and empty name both raise exceptions. IDs are prefixed ULIDs generated in TypeScript and passed in so ULID format stays consistent project-wide.
- `/onboarding/create-org` page + server action: org name form → `supabase.rpc('create_organization', …)` → redirect to `/app`. Skips onboarding if user already has an active membership.
- `/app` updated: queries `org_memberships` (RLS-filtered, so user only sees their own); redirects to `/onboarding/create-org` if no active membership; shows org name + role badge (e.g. "Client Admin").
- Middleware extended to guard `/onboarding/*` paths alongside `/app`.
- TypeScript strict: zero errors.

**What Went Wrong**:
- Nothing broke.

**What's Next**:
- **Step 5 — Sites: create + list, scoped to the org**: site name form on `/app/sites`, server action inserts via Supabase client (RLS enforces org scope), list refreshes after creation.

**Rules Followed**:
- ✓ Read design docs §3.2 + §4.1 before building (Rules 1, 2)
- ✓ One feature at a time (Rule 6)
- ✓ Tested register → create org → refresh → logout/login in browser (Rule 7)
- ✓ TypeScript strict clean before commit (Rule 7)
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Same conversation — fresh conversation before Step 5.

### Session 2026-06-24 — M0 / Feature 1, Step 5 — Sites: Create + List, Org-Scoped

**What I Built**:
- `/app/sites` page: lists the caller's org's sites (queried via the Supabase client so RLS applies); create form (name only) shown only when the caller holds `client_admin` in that org.
- `createSite` server action (`src/app/app/sites/actions.ts`): resolves `org_id` from the caller's own active `org_memberships` row (never trusts client input), inserts via the Supabase client — the existing `"sites: write if client_admin"` RLS policy (shipped in migration `0000`) is what actually blocks non-admins, the UI gating is just the friendly layer on top.
- Added a "Manage sites" link from `/app` to `/app/sites`.
- No new migration needed — the sites table + RLS policies already existed from Step 2.

**What Went Wrong**:
- Nothing in the app code. Tooling-only snag: no browser automation was available in-session (no `chromium-cli`, no Playwright pre-installed). Installed `playwright` standalone in the scratch dir (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`) and drove the existing system Edge install via `channel: 'msedge'` instead of downloading a bundled Chromium.
- Email confirmation is enabled on the Supabase project, so registering through the UI doesn't yield a session. Created two confirmed test users directly via the Supabase Admin API (service-role key, `auth.admin.createUser` with `email_confirm: true`) to get two real tenants to test cross-org isolation against.

**Verified in browser** (two real tenants, via Playwright/Edge):
- Tenant A creates "Plant A1" → appears immediately → persists after reload.
- Tenant B's `/app/sites` shows zero sites (cannot see "Plant A1"); creates "Plant B1" → appears.
- Back on Tenant A: still sees only "Plant A1" — confirms org-scoping holds in both directions.

**What's Next**:
- **Step 6 — Role-aware empty dashboard shell**, then deploy to staging — closes out Feature 1 / M0's foundation slice per `Feature1-Foundation-Brief.md`.

**Rules Followed**:
- ✓ Read `HowDesign-DataModel.md` §3.2/§4.1 + `Feature1-Foundation-Brief.md` before building (Rules 1, 2)
- ✓ One feature at a time (Rule 6)
- ✓ TypeScript strict, lint, and production build all clean
- ✓ Tested create → persist → cross-tenant isolation in a real browser (Rule 7)
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Same conversation — fresh conversation before Step 6.

### Session 2026-06-24 — M0 / Feature 1, Step 6 — Role-Aware Shell + Automated Isolation Test (Feature 1 complete)

**What I Built**:
- `src/app/app/layout.tsx`: shared shell for all `/app/*` routes. Reads the caller's role(s) from `org_memberships` once, shows the org name + role badge, and renders nav driven by a small `NAV_ITEMS`/`COMING_SOON` table keyed on `org_role` (imported from `db/schema.ts` so the role list has one source of truth). `client_admin` sees a live "Sites" link; `client_admin`/`content_developer`/`content_approver` see "Contractors"/"Orientations" as inert "Soon"-badged placeholders — nothing routes there, by design (no new feature pages). Logout moved here from the dashboard.
- Trimmed `/app/page.tsx` and `/app/sites/page.tsx` down to just their page content now that the header/nav/org/role chrome lives in the layout — removes the duplicate header markup both pages used to carry.
- `npm test`: added a `test` script running Node's **built-in** test runner (`node --env-file=.env.local --test`) against `.test.mts` files — no new test-framework dependency. Node 24's native TS type-stripping runs the `.ts` syntax directly; `.mts` avoids the CJS/ESM ambiguity warning.
- `src/test/two-tenant-isolation.test.mts`: the regression net from CLAUDE.md §7. Seeds two throwaway users via the Supabase admin API, signs each in, has each create an org + site through the real app path (`create_organization` RPC + a `sites` insert), then asserts under RLS: neither tenant can read the other's org or site (by direct id lookup *or* via an unfiltered listing), and tenant B's *write* into tenant A's org is rejected. Cleans up (auth user + all seeded rows) in an `after()` hook — verified no leftover rows/users after a run.
- `tsconfig.json` already globbed `**/*.mts`, so the test file is strict-TS-checked along with the rest of the app; no config changes needed there.

**What Went Wrong**:
- First dev-server restart after a fresh `npm run build` threw repeated `EPERM: operation not permitted, rename ...` errors inside `.next/dev/` (the repo lives inside a Dropbox-synced folder, which intermittently locks files mid-write on Windows). Fixed by killing the dev process, deleting `.next`, and restarting clean.
- No other surprises — RLS already enforced everything the isolation test checks; the test exists to keep it that way as the schema evolves.

**Verified**:
- `tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- `npm test` → all 7 isolation assertions pass against the live Supabase project; confirmed zero leftover seeded users/orgs afterward.
- Browser (Playwright/Edge), desktop + 375px mobile viewport: role-aware nav renders correctly for a Client Admin (Sites live, Contractors/Orientations "Soon"), no horizontal overflow at mobile width, and the full Feature 1 acceptance path holds end-to-end — create site → persists on reload → second tenant sees none of it.
- **Feature 1 (M0 foundation slice) Definition of Done is met**: register → login → create org → add site → refresh persists → second tenant isolated, proven both manually and by an automated test; lint + build green; BUILDLOG updated.

**What's Next**:
- `Jacques, ship check` → deploy (push auto-deploys to Vercel) → `Jacques, what's next` for **Feature 2**: the stubbed job-state-machine skeleton + fixed renderer (M0's remaining piece per `ExecutionPlan.md`, ahead of the real generation pipeline in M2).

**Rules Followed**:
- ✓ Read `Feature1-Foundation-Brief.md` + `HowDesign-DataModel.md` §2/§4 before building (Rules 1, 2)
- ✓ One feature at a time (Rule 6)
- ✓ Built the RLS regression-net test per §7, not just a manual check
- ✓ TypeScript strict, lint, and build all clean; tested in a real browser, including mobile width (Rule 7)
- ✓ No new runtime/test-framework dependency — used Node's built-in test runner (Rule 12, stack discipline)
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Same conversation — fresh conversation before Feature 2.

### Session 2026-06-24 — Feature 2, Step 1 — Jobs Table + Shared Contract Types + Inngest Stood Up

**What I Built**:
- Migration `0003_legal_photon.sql`: `generation_jobs` table per `orientation_pipeline_contracts_v0.1.md` §2 / `HowDesign-DataModel.md` §3.2 — flat indexable columns (`id`, `org_id`, `site_id`, `status`, `current_stage`, `rework_count`, `max_rework`, `qa_flagged`, `package_id`, `created_by`, timestamps, `idempotency_key`, unique) plus `jsonb` for `artifacts`/`qa_history`/`telemetry`/`error`. New `job_status` enum (the 10 states from contracts §1); `current_stage` reuses it so a `failed` job still records which working stage to re-enter on retry. RLS: org-scoped read for any member, write gated to `content_developer` (§4.1) — same pattern as `sites`. `source_asset`/`package_version`/`approved_by`/`approved_at` from the contract are deliberately deferred to the steps that actually need them (Step 3 upload, Step 5 publish) rather than added speculatively now.
- `src/test/generation-jobs-isolation.test.mts`: same regression-net pattern as the Feature 1 isolation test — two tenants, each granted `content_developer` via the service role (no invite flow exists yet to grant it through the app), each creates a job; asserts neither can read, list, update, or write into the other's org's job.
- `src/contracts/types.ts`: the shared TS types from contracts §5 (`JobStatus`, `JobRecord`, `BlockType`, `ContentBlock`, `HazardBlock`, `QuizQuestion`, `QAIssue`, `QAVerdict`, etc.) as the one module the rest of the app imports from instead of redeclaring these shapes. §5 references `SourceAsset`/`QAHistoryEntry`/`JobError` without defining them inline — backfilled their shapes from the §2 JSON example. Wired a real consumer immediately: `db/schema.ts`'s `jobStatusEnum` is declared `satisfies readonly [JobStatus, ...JobStatus[]]`, so the DB enum and the contract type can't silently drift (verified by deliberately injecting a bad value and watching `tsc` reject it).
- Inngest stood up: `inngest` package, `src/lib/inngest/client.ts`, `src/app/api/inngest/route.ts` (App Router `serve()`), and one `hello-world` function (`src/lib/inngest/functions/hello.ts`) triggered by a `test/hello.world` event. `INNGEST_DEV=1` added to `.env.local` (cloud mode otherwise demands a signing key).

**What Went Wrong**:
- The Dropbox-sync `.next` file-lock (flagged as a carried-forward item in `Feature2-Pipeline-Skeleton-Brief.md`, and the second time it's hit) recurred again on a dev-server restart. Fixed for real this time instead of just deleting `.next` again: set the `com.dropbox.ignored` NTFS alternate-data-stream attribute on `web/.next` (`Set-Content -Stream com.dropbox.ignored -Value 1`), which tells the Dropbox client to stop syncing/locking that folder. Shouldn't recur.
- First hit on `/api/inngest` 500'd with "no signing key found" — Inngest defaults to cloud mode. Fixed by setting `INNGEST_DEV=1` in `.env.local`.

**Verified**:
- `tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- `npm test` → 12/12 pass (5 new generation_jobs assertions + the 7 from Feature 1); confirmed zero leftover seeded rows/users afterward.
- Local Inngest dev server (`npx inngest-cli dev`) auto-discovered the app, and a `test/hello.world` event POSTed to it ran the `hello-world` function to `"status":"Completed"`.
- Confirmed a job row can be created and is RLS-scoped (both directly and via the automated test).

**What's Next**:
- **Step 2 — State machine + realtime tracker (all stages stubbed, incl. a placeholder extract)**: the Inngest durable workflow implementing contracts §1's transitions, a "create job" trigger for a site, and a Supabase-Realtime stage tracker UI showing a job advance to `awaiting_approval`.

**Rules Followed**:
- ✓ Read `Feature2-Pipeline-Skeleton-Brief.md` (Step 1 + working agreement), contracts §2/§5, and `HowDesign-DataModel.md` before building (Rules 1, 2)
- ✓ One step only — no state machine, no stages, no UI (working agreement: steps are never bundled)
- ✓ RLS shipped in the same migration as the table; automated isolation test added, not just a manual check
- ✓ TypeScript strict, lint, and build all clean; Inngest verified running locally, not just installed
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Same conversation — fresh conversation before Step 2.

### Session 2026-06-24 — Feature 2, Step 2 — State Machine + Realtime Tracker (All Stages Stubbed)

**What I Built**:
- Migration `0004_generation_jobs_step2_setup.sql`: broadened `generation_jobs` write RLS to `client_admin OR content_developer` (the Step 2 brief names both roles as able to trigger a job; `content_developer` isn't grantable yet — no invite flow until M1); enabled Supabase Realtime on `generation_jobs` for the tracker UI; created the private `pipeline-artifacts` Storage bucket (service-role only — no public access or object policies needed).
- `src/lib/inngest/functions/run-generation-job.ts`: the durable Inngest workflow (`runGenerationJob`) walking a job through `queued → extracting → structuring → generating_quiz → qa_review → awaiting_approval` (contracts §1). Each working stage (`extracting`/`structuring`/`generating_quiz`) is a stub: writes a canned envelope (`kind: "code"`, `stage_impl_version` `@stub-0.1`) to the `pipeline-artifacts` bucket and records the `ArtifactRef` (storage key + sha256 + produced_at) onto the job's `artifacts` jsonb. `qa_review` always passes (stub) and appends a `QAHistoryEntry`; the rework-loop columns exist but aren't exercised yet.
- `src/lib/inngest/events.ts`: the `generation/job.start` event type (`jobId`, `siteId`, `orgId`), wired into `api/inngest/route.ts`'s function list alongside `hello-world`.
- `src/app/app/jobs/actions.ts`: `createJob` server action — re-derives `org_id` from the caller's own membership (never trusts client input), confirms the target site belongs to that org, inserts the job row, then sends the Inngest event.
- `src/app/app/jobs/[jobId]/page.tsx` + `job-tracker.tsx`: the realtime stage tracker — subscribes to `postgres_changes` on the job's row, renders stage progress, artifacts, qa_history, and any error live.
- `src/lib/supabase/admin.ts`: service-role client for the Inngest workflow (durable steps can run well after the triggering request ends; bypasses RLS, server-only).
- `app/sites/page.tsx`: added a "Start generation" button per site, gated to `client_admin`/`content_developer` to mirror the RLS policy.
- Simplified `generation-jobs-isolation.test.mts`: dropped the manual `content_developer` role grant now that `client_admin` alone is sufficient to write a job under the broadened policy.

**What Went Wrong**:
- The session that wrote this code was interrupted before the final test + commit. Picked back up in a fresh, verification-only session: confirmed via direct DB queries (`pg_policy`, `pg_publication_tables`, `storage.buckets`, `drizzle.__drizzle_migrations`) that migration `0004` was already applied live even though the SQL file and code were still uncommitted — nothing was lost, just unrecorded in git.

**Verified**:
- `tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- `npm test` → 12/12 pass.
- Live end-to-end: started `next dev` + `npx inngest-cli dev`, provisioned a throwaway tenant/org/site, fired `generation/job.start`, and polled the job row live — walked `queued → extracting → structuring → generating_quiz → qa_review → awaiting_approval`, each stage landing a real stored artifact (sha256 + storage key) plus a `qa_history` pass entry. Cleaned up the test tenant afterward.

**What's Next**:
- **Step 3 — Real Python extractor**: replace the stubbed `extracting` stage with a real `python-pptx`/PDF function producing an `ExtractedDeck` (contracts §4.1); decide hosting (Vercel Python fn vs. a separate service).

**Rules Followed**:
- ✓ One step only — structure/quiz/QA stay stubbed, no real extractor yet (working agreement: steps are never bundled)
- ✓ RLS broadened deliberately and re-verified by the isolation test, not just assumed
- ✓ TypeScript strict, lint, and build all clean; proven with a live end-to-end run, not just unit tests
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Verification + commit done in a fresh conversation after the interrupted session; fresh conversation before Step 3.

### Session 2026-06-24 — Environment Fix — Dropbox `.next` Lock Recurrence (3rd time), Orphaned Dev Processes

**What I Built**: Nothing — no app code changed.

**What Went Wrong**:
- User hit a Next.js dev runtime error on logout: "Jest worker encountered 2 child process exceptions, exceeding retry limit." The logout server action itself (sign-out + redirect, ~3 lines) had nothing capable of causing it.
- Root cause was two compounding environment issues, both leftover from the Step 2 verification session: (1) the background `npm run dev` / `npx inngest-cli dev` processes started during that session's live e2e check were reported stopped by the tool, but their actual Windows process trees (PIDs for `next dev`, its `start-server.js` child, and a `jest-worker/processChild.js` grandchild, plus the Inngest dev binary) kept running orphaned; (2) the `com.dropbox.ignored` NTFS attribute on `web/.next` (set in Feature 2 Step 1 to stop Dropbox from sync-locking it) had been wiped when that session's `npm run build` recreated `.next`. With the flag gone, Dropbox resumed locking files inside `.next` mid-write while the orphaned server's worker child was reading/writing them — crashing it. This is the same family of issue as Step 1's `.next` EPERM lock, now its third occurrence.
- Fixed by: killing the orphaned `node` processes (verified via `Get-CimInstance Win32_Process` command lines before killing, to avoid touching unrelated processes), then re-applying `com.dropbox.ignored` to `web/.next` (confirmed present via `cmd dir /r`, since `Get-Item -Stream` doesn't reliably list directory-level ADS in PowerShell 5.1).
- **Learning carried forward**: background dev/Inngest servers started for verification must be confirmed actually dead (check `Get-CimInstance Win32_Process` / listening ports), not just trust a "stopped" status — and the Dropbox-ignore flag on `.next` should be re-checked after any `npm run build`, since a full build can recreate the directory and silently drop it.

**What's Next**: Resume Feature 2, Step 3 (real Python extractor) — unaffected by this.

**Context Usage**: Same conversation as the issue report — fresh conversation for Step 3.

---

## Track Progress

Use this log for continuity (paste last "What's Next" to start the next session), accountability (features shipped vs. stalled), and learning (what broke + fix).
