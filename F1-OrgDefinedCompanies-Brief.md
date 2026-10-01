# F1 — Org-Defined Contractor Companies + Nominated Admins (Plan-Mode Brief)

> **Feature goal:** a client org **defines** a contractor company (name, trades, contacts, business number, website) and **nominates its admin** — company staff, the org's own staff (in-house), or a third-party administrator. If the company already exists on the platform, the org **finds it and requests a link** instead of creating a duplicate; the company's admin accepts or declines. Existing users (in-house staff, third-party admins already running another company) can accept an admin invite while signed in. After setup, the **company's own admins** manage its admins.
>
> **Builds on F0:** a person can now hold many org + company memberships and switch between them — F1 creates those memberships.

---

## Working agreement (strict — do not deviate)

- The whole feature is the destination; reach it **one step at a time, in order**. **One step = one Claude Code prompt.**
- A step is **not done** until: it works in the browser (Rule 7); TypeScript strict + lint + build clean; automated tests cover it (incl. RLS isolation for every new table/RPC); committed and pushed (Rule 9); BUILDLOG updated (Rule 19).
- Tests run against **ConTrak Dev** only (`npm test`; the production guard refuses ConTrak). Schema changes: `npm run db:migrate` (dev) → verify → `npm run db:migrate:prod` only when the step ships.
- Splitting a step **smaller** is always allowed (Rule 10); merging steps **bigger** is not.
- **Start the build in a fresh conversation** (Rule 18) — this brief + BUILDLOG are the hand-off.

---

## The three questions (locked)

1. **What:** org-side "Add contractor company" with details + admin nomination; duplicate matching with **link requests** the company must accept; admin invites that **existing users** can accept; company-side **link-request inbox** and **Admins** page.
2. **Who:** Client Admins (define companies, nominate the first admin, request links); Contractor Admins of every type (accept invites and link requests, manage admins); third-party admins running several companies.
3. **Done:** Org A creates "Apex" with an in-house admin (an existing Org A user) → that user accepts while signed in and switches into Apex. Org B searches "Apex", sees only its name, requests a link → Apex's admin accepts → Org B now sees Apex. A third-party admin (already admin of Birch) accepts an Apex admin invite and runs both from the switcher. An Apex admin adds a company-staff admin and cannot remove the last admin. RLS tests prove a pending/declined link exposes nothing and no client can attach itself to a company.

## Decisions (confirmed 2026-10-01)

| # | Decision |
|---|---|
| F1-1 | Linking to an **existing** company requires the **company's acceptance**. Until accepted (link `invited`), the org sees nothing of that company's profile beyond the matched name, and none of its workers. Declined → link `declined`. |
| F1-2 | Duplicate search returns **name (+ province once F3 adds locations) only** — no contacts, no workers, no other clients. |
| F1-3 | The org nominates the **first** admin at creation (and may re-send or replace that nomination while it is unaccepted). After that **only the company's admins** add/remove admins, with a **last-admin guard**. |
| F1-4 | **Three admin types** on the admin's company membership: `company_staff` · `client_staff` (in-house) · `third_party`. Shown in both portals. |
| F1-5 *(locked, security)* | An admin invite can only be accepted by the person it was sent to: the signed-in user's primary or verified email must equal the invitation email. Forwarded links don't work. |
| F1-6 *(Ron, 2026-10-01)* | **Search first, to prevent duplicates (no merging later).** Search is fuzzy (typos, punctuation, "Ltd/Inc/Corp", partial names) and also matches business number and website domain. Companies the org is already linked to (or has requested) appear **with their link status** instead of disappearing. The database also refuses duplicates: **same business number never twice**; an **identical normalized name** needs an explicit "this is a different company" confirmation. |

## The current flow and its gaps (verified 2026-10-01)

- `inviteContractorCompany` creates a **stub** company (`Invited: <email>`) via the service-role client, a link (`invited`) and a `company` invitation; the **registrant names the company**.
- `/register/company` only **signs up a new account** → an existing user (in-house staff, third-party admin) gets "user already registered" and **cannot accept**.
- `accept_company_invite` (SECURITY DEFINER) takes `p_user_id` as a parameter (called with the service-role client); no email-match check; no admin type.
- Good: RLS helpers (`org_linked_company_ids`, `user_linked_org_ids`) only count **`active`** links — a pending request already grants no visibility.
- **Security holes found + closed in Step 1 (migration 0018; proven by an attack script before/after):** (a) a client admin could insert an **active** link to any company → read its profile and workers; (b) could flip its own pending link to active; (c) could insert a company-admin invitation for any company and call `accept_company_invite` (EXECUTE granted to PUBLIC, takes a user id) → **become that company's admin and rename it**. Production had no companies yet, so nothing was exposed.
- **Found in Step 1, fix in Step 2:** `sendEmail` throws when Resend refuses a recipient; with the test sender `onboarding@resend.dev` Resend only delivers to the account owner → every invite to anyone else 500s *after* the invite is created. Step 2: verified sending domain + graceful fallback (show the link).

## Canonical references

`ContractorNetwork-GapAnalysis.md` (G2, G3; D3; F1) · `HowDesign-DataModel.md` §3.3–3.4, §4.2–4.3 · `FunctionalOverview.md` §2, §3.2, decisions 21–24 · migrations `0007` (RLS helpers), `0008` (`accept_company_invite`), `0011` (worker claim pattern) · `F0-MultiMembership-Brief.md` (switching into the new company) · `CLAUDE.md`.

---

## Design

**Schema (one migration, Step 1)**
- `admin_type` enum: `company_staff`, `client_staff`, `third_party`. Columns: `company_memberships.admin_type` (set for `contractor_admin` memberships), `invitations.admin_type`.
- `contractor_companies`: `business_number` (text, optional), `website` (text, optional), `created_by_org_id` (FK organizations, nullable).
- `link_status` enum: add `declined`.
- RLS: members of `created_by_org_id` may **read the company profile** they defined (never workers — those stay gated by an `active` link).

**RPCs (SECURITY DEFINER, all use `auth.uid()`; none take a user id parameter)**
- `create_contractor_company(org, details…, admin_email, admin_type)` — caller must be `client_admin` of `org`; inserts company (`created_by_org_id = org`), link `invited`, admin invitation (7 days, single use). Replaces the service-role stub path.
- `find_company_matches(org, name, business_number, website)` — `client_admin` only; up to 5 `{id, legal_name}` matched on normalized name (case/punctuation/"Ltd/Inc/Corp" stripped), exact business number, or website domain; excludes companies already linked to `org`.
- `request_company_link(org, company_id)` — `client_admin` only; creates/re-opens a link as `invited` (no invitation row; nothing becomes visible).
- `respond_to_link_request(link_id, accept)` — caller must be `contractor_admin` of that company → `active` or `declined`.
- `accept_company_admin_invite(token)` — signed-in caller; checks pending/unexpired token and **email match (F1-5)**; creates the `contractor_admin` membership with the invited `admin_type`; activates the creating org's link; consumes the token. Replaces `accept_company_invite` (revoke + drop once unused).
- `invite_company_admin(company_id, email, admin_type)` / `remove_company_admin(membership_id)` — caller must be `contractor_admin` of that company; remove refuses the **last** admin.

**Flows**
- **Org → Contractors → "Add company":** details form → *possible matches* step (names only; "Request link" or "Create new company anyway") → admin nomination: email + type; for **Our staff** pick from the org's members → invite sent (Resend, or dev link on screen as today).
- **Invite link `/invite/company?token=…`:** signed in → "Accept as <name>" (email must match); signed out → sign in (existing account) or create account, then accept. On success set `ctx_company` to the new company (F0) and open the contractor portal.
- **Contractor portal:** "Client requests" (accept/decline pending links) and **Admins** (list with type, invite admin with type, remove with last-admin guard).
- Contractors page shows each company's link status (`invited` / `active` / `declined`) and pending admin nominations (re-send / replace while unaccepted).

---

## Build order (one step → test → commit; Rules 6, 7, 9)

**Step 1 — Schema, RPCs and RLS + tests (no UI).** The migration and all RPCs above. Tests (`company-definition.test.mts`, real Supabase): client_admin creates a company for their org, a non-admin and another org's admin cannot; match RPC returns only `{id, legal_name}` and never already-linked companies; a pending or declined link exposes **no** company profile beyond the name and **no** workers to the requesting org; only the company's admin can respond; invite acceptance fails on email mismatch, expiry and reuse; last-admin removal refused. *Done:* migration on ConTrak Dev, tests green, full suite green.

**Step 2 — Org "Add company" flow.** Form + match step + admin nomination (incl. "Our staff" picker) + invite delivery; Contractors page shows link status and pending nominations (re-send / replace). Retire `inviteContractorCompany`'s stub path. *Done:* in the browser an org creates a company with details and each admin type, and a match leads to a link request instead of a duplicate.

**Step 3 — Accepting an admin invite (new and existing users).** `/invite/company` page + `accept_company_admin_invite`; signed-in, sign-in and sign-up paths; F0 context set to the new company. Retire `/register/company` + `accept_company_invite`. *Done:* an existing org user and an existing admin of another company both accept while signed in and land in the new company; a forwarded link is refused.

**Step 4 — Company side: link requests + Admins page.** Inbox to accept/decline client link requests; Admins page (list with type, invite with type, remove with last-admin guard). *Done:* a company accepts Org B's request (Org B then sees it) and declines another; admins are added and removed with the guard.

**Step 5 — End-to-end verification + ship.** Seed script for the F1 personas (ConTrak Dev), browser click-through of the Definition of Done, full suite, BUILDLOG, then `Jacques, ship check` and `npm run db:migrate:prod`.

---

## Definition of Done (whole feature)

The scenario in "The three questions → Done" works in the browser; every new RPC and table has RLS tests (incl. "no client can attach itself to a company" and "pending/declined links expose nothing"); the old stub path and `accept_company_invite` are retired; tsc strict + lint + build clean; full suite green on ConTrak Dev; production migrated deliberately; BUILDLOG updated per step.

## Out of scope (carried forward)

- Capability catalog — trades stay free text until **F2**. Locations/province — **F3** (match results gain province then).
- Org-private notes / internal status on the link (D3 mentions it) — later feature.
- Org removing its own link to a company, merging duplicate companies, SMS invites, bulk import.
- `createSite` friendly role check, app font variable, "Create Next App" title (logged pre-existing nits).
