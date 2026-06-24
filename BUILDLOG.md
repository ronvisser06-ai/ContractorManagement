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

---

## Track Progress

Use this log for continuity (paste last "What's Next" to start the next session), accountability (features shipped vs. stalled), and learning (what broke + fix).
