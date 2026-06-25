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

### Session 2026-06-24 — Feature 2, Step 3 — Real Python Extractor (the flagged friction step)

**What I Built**:
- **Hosting decision (ExecutionPlan.md §6 decision #5):** a standalone Python service (`python-extractor/`) deployed as its own Vercel project, not mixed into the Next.js app — avoids re-fighting Vercel's Root Directory detection (already painful once for `web`) and keeps the polyglot seam as small as ExecutionPlan.md §2 intends. The Inngest workflow calls it over HTTP with a shared-secret bearer token; locally it runs via `uvicorn`. Creating the actual second Vercel project (dashboard step, Root Directory = `python-extractor`) is still on Ron, same as the original `web` project setup.
- Migration `0005_green_bromley.sql`: nullable `source_asset` jsonb column on `generation_jobs` (drizzle-kit generated from a `schema.ts` change, applied via `db:migrate`).
- Deck upload: `createJob` (`web/src/app/app/jobs/actions.ts`) now accepts a `.pptx`/`.pdf` file, validates by extension (not the browser-reported MIME, which is unreliable across OSes), sha256-hashes it, uploads via the admin client to `pipeline-artifacts` under `sites/{siteId}/jobs/{jobId}/source/{filename}`, and writes `source_asset` onto the job row at insert time. `idempotency_key` switched from a per-job stub to `{siteId}:sha256:{sha256}` (contracts §2's own example shape) so resubmitting the same deck for a site dedupes instead of spawning a duplicate job. `next.config.ts` server-actions body limit raised to 25mb (default 1mb is too small for a real deck). `sites/page.tsx` got a file input on the "Start generation" form.
- `python-extractor/`: FastAPI app (`app.py`) with one `/extract` endpoint, bearer-auth gated. `extract_pptx.py` and `extract_pdf.py` produce `ExtractedDeck` per contracts §4.1 — slides normalized from both source types into the same shape, text runs (one per non-empty paragraph, with `level`/`bold`), tables, speaker notes (pptx only), and image/media assets. Group shapes are flattened recursively. A video or picture whose relationship `target_mode` is External (points outside the package) is recorded `embed_state: "linked_missing"` with a `MEDIA_LINK_UNRESOLVED` warning instead of failing the job; embedded assets are uploaded straight to the same `pipeline-artifacts` bucket by the Python service itself (needs its own `SUPABASE_SERVICE_ROLE_KEY`) so the `ExtractedDeck` JSON never carries binary payloads inline. Best-effort theme read for `branding` (colors/fonts from the slide master's theme XML) — null when not confidently found, not a failure.
- `run-generation-job.ts`: the `extracting` stage is no longer stubbed. It reads the job's `source_asset`, creates a 5-minute signed URL for it, and POSTs `{ signed_url, source_type, job_id, site_id }` (never the file bytes) to the extractor; the real `ExtractedDeck` response is wrapped in the same stage-envelope pattern as the other artifacts and stored as `extracted_deck`. `structuring`/`generating_quiz`/`qa_review` are untouched, still stubbed.
- Tests (`python-extractor/test_extract.py`): a synthetic fixture (built with `python-pptx` itself, including a real *external* relationship via `part.relate_to(..., is_external=True)`) proves tables, speaker notes, and a linked-missing video surface correctly — the brief's explicit ask — since no real deck was on hand yet when this was first scoped. A PDF smoke test confirms that path doesn't crash either.

**What Went Wrong**:
- Ron dropped a real 63-slide deck (`SampleOrientation/2025 Proton Safety Orientation_V2.0_Draft (1).pptx`, 8.8MB) into the repo mid-session — used it instead of relying solely on the synthetic fixture, and gitignored the folder (real customer content, not for the repo).
- That real deck caught an actual bug the synthetic fixture couldn't have: 3 of its 45 images are modern Office vector icons referenced via an `<a16:svgBlip>`/`<asvg:svgBlip>` extension on the blip, not the classic `r:embed` attribute `shape.image` reads. First pass misclassified all 3 as `linked_missing` (wrong — they're fully embedded, just referenced differently). Fixed by falling back to a generic scan for any `r:embed`/`r:link` anywhere under the shape before concluding a picture is genuinely linked-and-missing. Re-ran against the real deck: 45/45 correctly `embedded`, 0 false-positive warnings.
- `_branding()`'s first draft called `.element` on the theme part — `part_related_by` returns a generic `opc.package.Part`, not an XML-aware part, so that attribute doesn't exist. Fixed by parsing `theme_part.blob` directly with `lxml.etree.fromstring`.
- First live e2e attempt timed out: the script's 60s deadline was too short for a real 45-asset deck (Python uploads each asset to Storage sequentially), and the timeout's cleanup path deleted the job row out from under a still-running Inngest step. Re-ran with a 5-minute deadline — the real run actually completed in ~73s end-to-end; no code changes needed, just a more realistic test timeout.

**Verified**:
- `tsc --noEmit`, `npm run lint` (web), `npm run build` all clean. `python-extractor/test_extract.py` — 3/3 pass.
- Live end-to-end against the real deck: started `next dev` (Ron's own, already running from the prior session) + `npx inngest-cli dev` + `uvicorn app:app`, uploaded the real `.pptx` to Storage exactly as `createJob` would, fired the job, and watched it walk every state to `awaiting_approval`. Downloaded the resulting `extracted_deck` artifact mid-run and asserted `produced_by.stage_impl_version == "extracting@real-0.1"` (not a stub), 63 slides, 45 assets, 0 warnings.
- `npm test` → 12/12 pass (unaffected, regression net still green).

**What's Next**:
- **Step 4 — Fixed renderer** for the closed block-type set (contracts §4.3), rendering the canned content model from the still-stubbed structuring stage.
- Carried forward: actually create the second Vercel project for `python-extractor/` (Root Directory = `python-extractor`) when ready to deploy past local dev.

**Rules Followed**:
- ✓ Read `Feature2-Pipeline-Skeleton-Brief.md` Step 3 + working agreement, contracts §2/§4.1, and ExecutionPlan.md §6 decision #5 before building (Rules 1, 2)
- ✓ One step only — structure/quiz/QA stay stubbed (working agreement: steps are never bundled)
- ✓ Hosting decision made deliberately and flagged, not just defaulted (Rule 12: architectural changes get flagged)
- ✓ Tested against a real deck, not just a synthetic one, once available — and the synthetic fixture still covers what the real deck didn't exercise (Rule 7)
- ✓ TypeScript strict, lint, and build all clean; Python tests green; proven with a live end-to-end run against real content
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Single conversation, friction step as flagged — fresh conversation before Step 4.

### Session 2026-06-24 — Feature 2, Step 4 — Fixed Renderer for the Closed Block-Type Set

**What I Built**:
- `src/contracts/types.ts`: full `ContentModel` shape (meta, branding, modules, hazard_index) plus typed interfaces for all nine closed block types (contracts §4.3) and a `ValidatedBlock` discriminated union — what the renderer receives once a raw block has passed validation.
- `src/lib/renderer/validate.ts`: hand-rolled per-type schema validation (no new dependency — nine small fixed shapes don't justify pulling in a schema library). `validateBlock` checks `id`/`source_ref` generically, then per-type required fields; returns a structured error rather than throwing for anything unknown or malformed.
- `src/components/renderer/`: `blocks.tsx` (the nine block components — heading/paragraph/list/key_point/callout/hazard/image/video/table — plus `UnknownBlockPlaceholder`), `BlockRenderer.tsx` (validates then dispatches; unknown/invalid blocks get a visible dashed placeholder in dev, render nothing in prod), `ContentModelView.tsx` (top-level: meta header + modules). Mobile-first Tailwind throughout; block text is always rendered as plain text content, never as injected markup. Image/video resolve through `next/image`/`<video>` from a signed-URL map built server-side per request (`resolve-asset-urls.ts`) — `unoptimized` on `next/image` since signed URLs are per-request and short-lived, so the optimizer can't usefully cache them.
- `src/lib/renderer/fixture.ts`: a canned `ContentModel` (two modules — "Welcome & Site Overview", "Confined Space Entry") exercising all nine block types, plus one deliberately invalid block type (`carousel`) to prove the rejection path. Deliberately synthetic, not derived from any real extracted deck — structuring is still stubbed (M2 brings real AI structuring). Two synthetic placeholder JPEGs (generated locally, not from any customer deck) uploaded to `pipeline-artifacts` under `fixtures/content-model-preview/` for the image blocks; the video block's asset is deliberately *not* uploaded, exercising the "Video unavailable" graceful-fallback path (no ffmpeg available locally to synthesize a real clip, and the brief didn't call for one).
- `/preview/content-model`: dev/QA-only route (unauthenticated — canned data only, no tenant exposure) rendering the fixture. `export const dynamic = 'force-dynamic'` — caught during build verification that without this, Next prerendered the route at *build* time and baked one set of signed URLs into static HTML, which would expire; forced dynamic so URLs resolve fresh per request as the contract requires ("resolved to a signed URL only at render time").
- `src/test/content-model-validate.test.mts`: pure logic test (no Supabase, no DOM) — all nine valid block shapes pass, four invalid/unknown cases return a structured error without throwing.
- `tsconfig.json`: added `allowImportingTsExtensions` so the new test can import `validate.ts` directly with Node's required explicit `.ts` extension under `tsc --noEmit`. `src/package.json` (`{"type":"module"}`) scopes ESM resolution to `src/` only, silencing a Node module-type warning on that same import without touching the root package's CommonJS-default tooling.

**What Went Wrong**:
- The first build silently prerendered `/preview/content-model` as a *static* page — Next had no way to detect the Supabase signed-URL call as dynamic data, so it baked build-time URLs into the HTML (they'd 404 after expiry, defeating the whole point of "resolved at render time"). Fixed with `export const dynamic = 'force-dynamic'`.
- Jacques' eyes-on-it check (Rule 8) caught a real mobile bug a code review wouldn't have: at 375px, the hazard card's text was cut off and its `CRITICAL` badge was pushed off-screen entirely — real horizontal page overflow, not just a cramped layout. Root cause: the root `<body>` (`app/layout.tsx`) is `flex flex-col`, and the renderer's top-level container used `mx-auto` (auto margins) without an explicit width. Per the flexbox spec, auto margins on a flex item *disable* cross-axis stretch, so the item fell back to shrink-to-fit sizing — and the table block's `min-w-[480px]` (its own intentional horizontal-scroll mechanism) became that fit-content floor, widening the *entire page* to ~514px regardless of viewport. `min-w-0` alone didn't fix it (that only caps the minimum, not the base size); the real fix was adding an explicit `w-full` alongside `mx-auto max-w-2xl`. Confirmed via direct DOM measurement (`getBoundingClientRect`) before and after, not just visual inspection.
- Mid-session the original ~8.8MB sample deck was replaced in `SampleOrientation/` with a smaller ~5.9MB one (Dropbox sync lag meant the file list looked stale momentarily) — re-ran the full Steps 1-3 pipeline regression (upload → real extractor → stubbed stages → `awaiting_approval`) against whichever file was actually present rather than a hardcoded name, confirming filename and size first. Pipeline unaffected by Step 4's changes, as expected (the renderer consumes the canned fixture, never extractor output, in this skeleton).

**Verified**:
- `tsc --noEmit`, `npm run lint`, `npm run build` all clean (preview route correctly shows as `ƒ` dynamic in the build output, not `○` static).
- `npm test` → 25/25 pass (13 new validator assertions + the 12 existing isolation tests, unaffected).
- Real browser check (Playwright/Edge) at desktop (1280px) and 375px mobile, focused on the hazard and callout blocks per Jacques' note: all nine block types render correctly at both widths after the overflow fix; the deliberately-unknown `carousel` block shows a clear dashed amber placeholder instead of crashing; the missing video asset shows a clean "Video unavailable" card instead of a broken element.
- Live pipeline regression: re-ran Steps 1-3 end-to-end against the updated (smaller) real deck in `SampleOrientation/` — `queued → extracting → structuring → generating_quiz → qa_review → awaiting_approval`, real `extracted_deck` artifact written. Confirms Step 4 didn't disturb the existing pipeline.

**What's Next**:
- **Step 5 — Approval gate + publish**: the `awaiting_approval` screen (rendered draft + canned quiz + any `qa_flagged` issues), approve → `publishing` → `published`, writing an immutable hash-pinned `OrientationPackage`.

**Rules Followed**:
- ✓ Read `Feature2-Pipeline-Skeleton-Brief.md` Step 4 + working agreement, contracts §4.2/§4.3 before building (Rules 1, 2)
- ✓ One step only — no approval/publish UI, that's Step 5 (working agreement: steps are never bundled)
- ✓ Closed block-type set enforced by a real validator, not just renderer-side trust (CLAUDE.md §5)
- ✓ Eyes on it in a real browser at both widths (Rule 8) — caught a real bug a type-check couldn't have
- ✓ TypeScript strict, lint, and build all clean; tests green; pipeline regression re-verified live
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Same conversation, picked back up cleanly after a mid-session interruption rather than discarding completed work — fresh conversation before Step 5.

### Session 2026-06-24 — Feature 2, Step 5 — Approval Gate + Publish (Feature 2 complete, M0 done)

**What I Built**:
- Migration `0006_nappy_mentor.sql` (drizzle-generated, hand-extended with RLS): `orientation_packages` table per contracts §4.6 / HowDesign-DataModel.md §3.2 (id, org_id, site_id, version, supersedes_id, content_model_ref, quiz_ref, asset_manifest, content_hash, requalification_policy, qa_flagged, status, approved_by, approved_at, published_at, created_at), `unique(site_id, version)`, RLS (read if org member; write if `content_approver` — matching the access table's single named role, no broadening). Also added the `package_version`/`approved_by`/`approved_at` columns on `generation_jobs` deliberately deferred since Step 1, and broadened that table's write policy to add `content_approver` alongside `client_admin`/`content_developer` (every role that legitimately writes some column across the job's lifecycle). Caught a Postgres NOTICE mid-migration — the first policy name was truncated at the 63-byte identifier limit — renamed to something shorter in both the file and the already-applied live policy.
- `src/contracts/types.ts`: `Quiz`/`QuizMeta` (contracts §4.4) and `OrientationPackage` (contracts §4.6) types.
- `run-generation-job.ts`: the `structuring`/`generating_quiz` stub payloads are no longer a generic `{note: "..."}` placeholder — they're now a small but *real* canned `ContentModel` (one module: heading, paragraph, a hazard block) and a `Quiz` whose question's `source_refs` actually cites the hazard block. Necessary plumbing, not scope creep into M2: Step 5's review screen needs something real to render and cite, still entirely code-generated rather than AI.
- `publish-orientation-package.ts`: new Inngest function, triggered by a new `generation/job.approve` event, driving `publishing → published` — computes `content_hash` (`sha256(contentModelSha256:quizSha256)`), the next `version` and `supersedes_id` for the site (query max version, +1), inserts the immutable package row, sets `generation_jobs.package_id`/`package_version`, and updates `sites.active_package_id` (the column's documented purpose — "the one active orientation").
- Approval gate: `[jobId]/actions.ts` (`approveJob`) and `[jobId]/approval-review.tsx`. The action's real gate isn't RLS (which permits client_admin/content_developer/content_approver to write `generation_jobs` for other legitimate reasons) — it explicitly re-checks the caller's `org_memberships.roles` for `content_approver` before touching anything, then moves the job to `publishing` via the approver's own session and fires the approve event. The review screen renders the draft through the Step 4 `ContentModelView`, the quiz via a new `QuizView` (each question's `source_refs` resolved to the actual cited block's text, not just an opaque id — the audit trail is only useful to a reviewer if they can see what's cited), a `qa_flagged` banner, and the requalification-policy picker + approve form (hidden entirely for non-approvers, who see a "waiting for a Content Approver" message instead). `JobTracker`'s stage list now extends through `publishing`/`published` so the whole skeleton's progress is visible, not just up to `awaiting_approval`.
- `src/test/orientation-packages-isolation.test.mts`: same regression-net pattern as the other isolation tests, plus one beyond the template — a `client_admin` *without* `content_approver` is rejected on write, proving the role check is specific, not just "any org member."

**What Went Wrong**:
- Nothing broke in the app logic. One transient test flake: running the full suite once showed `generation-jobs-isolation.test.mts` failing, but it passed clean in isolation and on every subsequent full-suite run (30/30) — concurrent Supabase Auth admin calls across test files occasionally tripping something transient, not a real regression from this step's changes. Re-ran to confirm before treating it as green.

**Verified**:
- `tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- `npm test` → 30/30 pass (5 new orientation_packages isolation assertions + the 25 existing, unaffected).
- Live end-to-end against the real deck in `SampleOrientation/`: ran a job to `awaiting_approval`, approved as a `content_approver` (granted directly via the service role — flagged per the brief, no invite flow exists yet to grant it through the app) → published package **v1**, `content_hash` present, `supersedes_id` null, `requalification_policy` recorded correctly. Ran a second job on the **same site** → published **v2** whose `supersedes_id` correctly points at v1, and `sites.active_package_id` correctly updated to v2. A second test user holding `content_developer` but *not* `content_approver` was correctly rejected when attempting to approve a third job.

**What's Next**:
- **Feature 2 / M0 is complete** — the full walking skeleton (job record → real extraction → stubbed structure/quiz/QA → live tracker → approval gate → immutable versioned publish) runs end to end. `Jacques, ship check` → deploy, then `Jacques, what's next` for **M1** (tenancy, sites & contractor CRM) per ExecutionPlan.md.
- Carried forward: actually create the second Vercel project for `python-extractor/` when ready to deploy past local dev (flagged since Step 3).

**Rules Followed**:
- ✓ Read `Feature2-Pipeline-Skeleton-Brief.md` Step 5 + working agreement, contracts §1/§4.4/§4.6, and `HowDesign-DataModel.md` before building (Rules 1, 2)
- ✓ One step only — no bounded block editor, that's M2 per contracts §7 (working agreement: steps are never bundled)
- ✓ RLS matches the access-control table's named role exactly (content_approver only on orientation_packages), with the finer "which specific action" rule correctly left to application code, consistent with how every other action-level check in this project works
- ✓ TypeScript strict, lint, and build all clean; tests green; proven with two live publish runs plus a live rejection, not just unit tests
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Single conversation — Feature 2 complete, fresh conversation before M1.

### Session 2026-06-25 — M0 Deploy + Sentry

**What I Built**:
- Confirmed the two env vars needed for non-pipeline production flows: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — both set in Vercel Production.
- Added `python-extractor/runtime.txt` → `python-3.12` (future-proofing for when the extractor Vercel project is created in M2; fixes the `str | None` PEP 604 syntax incompatibility with Vercel's default Python 3.9 runtime).
- Wired Sentry via `@sentry/wizard@latest -i nextjs`: installed `@sentry/nextjs`; created `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/app/global-error.tsx`; patched `next.config.ts` with `withSentryConfig` (org `visser-solutions-inc`, project `javascript`). `SENTRY_AUTH_TOKEN` written to `web/.env.sentry-build-plugin` (gitignored, never committed — confirmed via `git log`). Sentry vars to set in Vercel Production: `SENTRY_AUTH_TOKEN` (secret), `SENTRY_ORG=visser-solutions-inc`, `SENTRY_PROJECT=javascript`, `NEXT_PUBLIC_SENTRY_DSN`.
- Removed both wizard-generated test routes (`web/src/app/sentry-example-page/`, `web/src/app/api/sentry-example-api/`) before committing — never tracked.
- Prod smoke: latest Vercel production deploy **● Ready** at `https://contractor-management-brown.vercel.app`. Manual register → create org → add site verification pending Ron.

**What Went Wrong**:
- `@sentry/wizard` requires an interactive TTY and was run by Ron manually (`! npx @sentry/wizard@latest -i nextjs --no-telemetry`); the wizard's non-interactive run from the Claude Code sandbox fails with `ERR_TTY_INIT_FAILED`. Documented so future Sentry updates know to run the wizard from a real terminal.

**What's Next**:
- Ron manually verifies the prod smoke test: register → create org → add site on `contractor-management-brown.vercel.app`.
- **M2-deploy task list** (deferred from M0, execute when M2 generation pipeline is ready to ship):
  - [ ] **Inngest Cloud**: create app → get `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` → set both in Vercel Production → remove `INNGEST_DEV=1` from prod env → register endpoint `https://contractor-management-brown.vercel.app/api/inngest` in Inngest dashboard.
  - [ ] **python-extractor Vercel project**: create in Vercel dashboard (Root Directory = `python-extractor`) → set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXTRACTOR_SHARED_SECRET` → confirm `/health` returns `{"status":"ok"}`.
  - [ ] **Wire extractor into web**: set `EXTRACTOR_URL` (deployed extractor URL) and `EXTRACTOR_SHARED_SECRET` in Vercel Production for the web project.
  - [ ] **Decide extractor timeout host before pilot**: real 45-asset deck took ~73s; Vercel Hobby caps at 10s, Pro at 60s — neither covers the worst case. Options: Vercel Pro + `maxDuration: 300`, or move extractor to Fly.io/Railway. Decide and implement before the pilot.
- Start **M1 — Tenancy, Sites & Contractor CRM** per ExecutionPlan.md.

**Rules Followed**:
- ✓ Report-only audit before acting (no changes without confirmation)
- ✓ Test routes deleted before commit — never shipped to production
- ✓ Secret (`SENTRY_AUTH_TOKEN`) gitignored and never committed; verified via `git log`
- ✓ M2-deploy tasks written down explicitly so nothing is forgotten at M2 ship time

**Context Usage**: Fresh conversation — M0 deploy closed out; fresh conversation before M1.

### Session 2026-06-25 — M1 / Step 1 — Contractor + Bridge Schema + Relationship-Derived RLS

**What I Built**:
- `schema.ts`: 7 new enums (`company_role`, `onboarding_status`, `link_status`, `assignment_status`, `invitation_channel`, `invitation_type`, `invitation_status`) and 7 new tables (`contractor_companies`, `company_memberships`, `user_emails`, `client_company_links`, `site_company_assignments`, `site_worker_activations`, `invitations`), all per HowDesign-DataModel.md §3.3–3.4. `invitations.channel` column included even though SMS is deferred.
- Migration `0007_chubby_baron_zemo.sql` (drizzle-generated, hand-extended with RLS):
  - 3 SECURITY DEFINER helper functions (`user_company_ids`, `user_linked_org_ids`, `org_linked_company_ids`) wired together to express the cross-domain relationships without recursion.
  - Covering indexes on `company_memberships(company_id)` and `client_company_links(company_id)` (the right-prefix lookups not covered by the unique-constraint btree).
  - 18 RLS policies across the 7 tables enforcing the three-domain model: own members read/write, linked clients read (sliced view enforced at app layer), unrelated parties see nothing.
- `contractor-crm-isolation.test.mts`: 16 assertions proving the RLS: contractor admin sees own company + memberships + link; linked client sees all three; unrelated client sees none of them; write isolation enforced (unrelated client can't insert companies/foreign links; linked client can't write memberships).

**What Went Wrong**:
- Nothing. Migration applied clean; all 43 tests pass on first run.

**Verified**:
- `tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- `npm test` → 43/43 pass (16 new + 27 existing, unaffected).

**What's Next**:
- **Step 2 — Client invites a contractor company**: Client Admin "Contractors" page, invite form (company contact email), creates `invitations` row (type=company, tokenized) + `client_company_links` row (status=invited), dev-mode link displayed/logged. No email yet.

**Rules Followed**:
- ✓ Read `M1-ContractorCRM-Brief.md` Step 1 + working agreement, `HowDesign-DataModel.md` §3.3–3.4 + §4.2–4.5 before building (Rules 1, 2)
- ✓ One step only — no UI, no invite flow, no Step 2 tables seeded beyond what RLS testing requires
- ✓ Helper functions SECURITY DEFINER to break the policy → subquery recursion that felled earlier helper patterns
- ✓ TypeScript strict, lint, and build all clean; 43 tests green
- ✓ Committed and pushed (Rule 9)

**Context Usage**: Single conversation — fresh conversation before Step 2.

---

## Track Progress

Use this log for continuity (paste last "What's Next" to start the next session), accountability (features shipped vs. stalled), and learning (what broke + fix).
