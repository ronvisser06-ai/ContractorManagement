# F0 — Multi-Membership Context (Plan-Mode Brief)

> **Feature goal:** one person can belong to **any number of client orgs and contractor companies at once** and move between them safely. This is the foundation for Contractor Network v2 (`ContractorNetwork-GapAnalysis.md`): third-party admins running several companies (F1), workers employed by more than one contractor, and org staff who also administer a contractor company.
>
> **Scope decisions (locked):** no schema change and no RLS change. The data model is already many-to-many (`org_memberships`, `company_memberships`); only the **application layer** assumes "exactly one". The active context is a **selection among memberships the user already has**. It never grants access, and row-level security stays the enforcement layer.

---

## Working agreement (strict — do not deviate)

- The whole feature is the destination; reach it **one step at a time, in order**.
- **One step = one Claude Code prompt.** Steps are never bundled.
- A step is **not done** until: it works in the browser (Rule 7); TypeScript strict + lint + production build are clean; an automated test covers it where applicable; it's committed and pushed (Rule 9); BUILDLOG is updated (Rule 19).
- **The next step does not begin until the current step meets that bar.** Jacques checks between steps.
- Splitting a step **smaller** is always allowed (Rule 10); merging steps **bigger** is not.

---

## The three questions (locked)

1. **What:** replace every "which org / which company am I in?" lookup with a **membership context**: the user's full list of active memberships, plus an **active org** and **active company** chosen by the user, remembered in a cookie, and validated on every request. Add a switcher and a post-login landing route.
2. **Who:** anyone with more than one membership. That includes third-party / agency admins, workers at several contractors, Client Admins who are also Contractor Admins, and consultants in several client orgs. Single-membership users must see **no change** apart from the new landing route.
3. **Done:** a test user with **2 contractor companies + 1 client org** (admin in one company, worker in the other) can sign in, land on a chooser, open each portal, switch company from the header, and see the right data and the right navigation for their role in *that* company. No redirect loops. All existing tests still pass.

## The bug this fixes (verified 2026-09-30)

Portal pages find "my org" / "my company" with `.eq('user_id', user.id).eq('status','active').maybeSingle()`. With 2+ rows, `maybeSingle()` returns **no data** (error `PGRST116`, confirmed by probe against ConTrak), and the pages redirect:

| Who | What happens today |
|---|---|
| Member of **2 companies**, no org | `/company` → `/login` → proxy sends signed-in users to `/app` → `app/layout.tsx` finds no single org and no single company → **`/onboarding/create-org`**. The worker is asked to create an organization. |
| Member of **2 orgs** | `/app` → no single org → `/onboarding/create-org` → its `.limit(1)` check finds an org → `/app` → … **infinite redirect loop.** |
| 1 org + 1 company | Works (each lookup finds exactly one row). |

It is reachable in production code today: `company/workers/actions.ts → addWorker` links an **existing** user to a second company.

## Canonical references

`ContractorNetwork-GapAnalysis.md` (G1, F0) · `HowDesign-DataModel.md` §2 (identity), §3.2–3.3 (memberships), §4 (RLS, unchanged) · `FunctionalOverview.md` §2 (roles are additive), §3.2 (one identity, many relationships) · Next.js 16 docs in `web/node_modules/next/dist/docs/`: `cookies.md` (async; **set only in a Server Function or Route Handler, never during Server Component render**) · `CLAUDE.md`.

---

## Design

**Membership context module**: `web/src/lib/context/membership.ts` (server-only)

- `getMyMemberships(supabase, userId)` → `{ orgs: OrgCtx[], companies: CompanyCtx[] }`. Active memberships only, each with id, display name and roles, ordered by `created_at` so the default is deterministic. Two queries, both already allowed by existing RLS.
- `resolveActive(list, cookieValue)`: a **pure function**. It returns the membership matching the cookie if it's in the user's list, otherwise the first one (or `null`). A forged or stale cookie simply falls back and can never select something the user isn't a member of.
- `getActiveOrg()` / `getActiveCompany()` combine the two for layouts, pages and server actions. They return `{ active, all }`, so the switcher can render without another query.
- Cookies: `ctx_org`, `ctx_company`. Values are **ids only** (no PII): `httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'`, 180-day max age.

**Switching**: server action `switchContext(kind: 'org' | 'company', id)`. It re-checks the id against `getMyMemberships`, sets the cookie, and redirects to that portal's home. It never writes a cookie for an id the user doesn't hold. When no valid cookie exists, pages use `resolveActive`'s default **without** setting a cookie (cookies can't be set during render).

**Landing / routing**
- `/` (currently the create-next-app boilerplate) becomes a **router**:
  - not signed in → `/login`
  - exactly one membership overall → that portal
  - more than one → a **chooser** (a list of orgs and companies with the role in each)
  - none → `/onboarding/create-org`
- `login` action and the proxy's "signed-in user on /login" redirect go to `/` instead of `/app`.
- `app/layout.tsx`: no active org → `/` (not create-org). `company/layout.tsx`: no active company → `/` (not `/login`). `create-org` keeps its "already has an org → /app" check; the loop disappears because `/app` now finds the org.

**Switcher UI**: shown in the `/app` and `/company` headers **only when the user has more than one** of that kind. It lists names with the role in each, marks the current one, and has a "Switch portal" link to `/` when the user also has the other kind. `account/layout.tsx` back-links use the lists (show "Admin portal" if any org, "Contractor portal" if any company).

**Call sites to convert** (19 lookups in 15 files; lookups already scoped by a specific `id` / `company_id` / `org_id` stay as they are)

| Portal | Files |
|---|---|
| Contractor (7) | `company/layout.tsx`, `company/profile/page.tsx`, `company/profile/actions.ts`, `company/workers/page.tsx`, `company/workers/actions.ts` (`requireContractorAdmin`), `company/crew/page.tsx`, `company/crew/actions.ts` |
| Client (10) | `app/layout.tsx` (×2), `app/contractors/page.tsx`, `app/contractors/actions.ts`, `app/team/page.tsx`, `app/team/actions.ts`, `app/sites/page.tsx`, `app/sites/actions.ts` (×2), `app/jobs/actions.ts` |
| Account (2) | `account/layout.tsx` (×2) |

**Server actions** must use the **active** context (never "the first membership"), and keep their existing role checks against the roles *in that context*. RLS still rejects any write outside the user's memberships.

---

## Build order (one step → test → commit; Rules 6, 7, 9)

**Step 1 — Membership context module + tests (no UI changes).**
Add `lib/context/membership.ts` (`getMyMemberships`, `resolveActive`, `getActiveOrg`, `getActiveCompany`, cookie names/options) and the `switchContext` server action. Tests (`src/test/membership-context.test.mts`):
- `resolveActive`: valid cookie → that membership; foreign/forged id → default; empty cookie → first by `created_at`; empty list → `null`.
- Real-Supabase test: a seeded user with 2 companies (admin in one, worker in the other) + 1 org. `getMyMemberships` returns all three with the correct roles; a user from an unrelated tenant sees none of them.

*Done:* module + tests green; nothing user-visible changes.

**Step 2 — Landing router + fix the redirect paths.**
Replace `app/page.tsx` with the router + chooser. Point `login` and the proxy's signed-in redirect to `/`. Change the "no membership" redirects in `app/layout.tsx` and `company/layout.tsx` to `/`. *Done:* in the browser, single-org and single-company users land where they did before; a 2-company user lands on the chooser; a 2-org user no longer loops.

**Step 3 — Contractor portal on the active company + switcher.**
Convert the 7 contractor-portal call sites to `getActiveCompany()`; add the company switcher to `company/layout.tsx`; nav shows admin items only when the user is `contractor_admin` **in the active company**. *Done:* the test user switches between their two companies; Profile/Workers/Crew show the right company, and admin-only pages are hidden (and their actions refused) in the company where they're only a worker.

**Step 4 — Client portal on the active org + switcher.**
Convert the 10 client-portal call sites to `getActiveOrg()`; add the org switcher to `app/layout.tsx`; update `account/layout.tsx` back-links to use the lists. *Done:* a user in 2 orgs switches between them; Sites / Contractors / Team / Jobs show only the active org's data; role-based nav follows the active org.

**Step 5 — Multi-membership end-to-end verification.**
Seed the F0 test persona (script under `web/scripts/`, test users only). Click through every portal page in both contexts, run the **full** test suite, and record results in BUILDLOG. *Done:* Definition of Done below is met.

---

## Definition of Done (whole feature)

The multi-membership persona (2 companies with different roles + 1 org) can use every existing page in every context, switch from the header, and never hit a redirect loop or the create-org screen. Single-membership users see no change except the landing route. A forged `ctx_*` cookie cannot select a context the user doesn't hold (tested). The full test suite passes (83 existing + new). TypeScript strict + lint + build clean; BUILDLOG updated per step. Then `Jacques, ship check`.

## Out of scope (carried forward, don't lose these)

- Renaming `middleware.ts` → `proxy.ts` (Next.js 16 naming; behaviour unchanged). Separate tidy-up.
- Making the test script sequential (`--test-concurrency=1`) and purging the 60 orphaned test `users` rows (plan item F8). Until then, run new tests one file at a time on a fresh Supabase project.
- Org-nominated / third-party admins and multiple admins per company (**F1**). F0 only makes such users *work*; F1 lets you *create* them.
- Production still points at the deleted Supabase project (M2 Step 5). Independent of F0.
