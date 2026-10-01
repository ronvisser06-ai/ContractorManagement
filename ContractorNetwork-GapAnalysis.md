# Contractor Network v2 — Current State, Gap Analysis & Build Plan

| | |
|---|---|
| **Status** | **Approved 2026-09-30** — D1, D2, D3, D5 confirmed; D4, D6, D7 stay proposed until F4 / F7. F0 shipped (`F0-MultiMembership-Brief.md`). **F1 brief: `F1-OrgDefinedCompanies-Brief.md`** (decisions F1-1…F1-5 confirmed 2026-10-01) |
| **Date** | 2026-09-30 |
| **Scope** | Contractor companies, their admins, locations, capabilities, facility mapping, worker profiles, credentials, and orientation records |
| **Supersedes on approval** | FunctionalOverview §3.2 ("lightweight CRM"), §9 (Certs Check exclusion, partially); ExecutionPlan sequencing |

---

## 1. Target (as requested)

1. An **organization defines its contractor companies**.
2. Each company gets an **admin** assigned by the organization — in-house (the org's own person), external (someone at the contractor company), or a **third party** (e.g. an agency that may administer several companies).
3. A company is profiled with its **locations** (offices/yards), its **capabilities**, and the **capabilities of each location** — defaulting to *all company capabilities at all locations*, then managed per location.
4. The organization **maps contractor locations to its own facilities** (sites).
5. The company maintains its **employees/contractors** and **where each one works**.
6. Each worker has a **profile**: work contact details (optionally LinkedIn); **tickets, certificates, designations**; **experience**; and the **companies and facilities they've been oriented at**.
7. Each **orientation record** shows: client company, orientation name, description, completion date, and expiry date (when the client set one). The profile lists **companies → orientations**.

---

## 2. How this was tested (2026-09-30)

- **Automated:** 8 contractor-domain suites, 51 tests, run one at a time against the ConTrak database — **51/51 pass.** They cover company invite + registration, worker enrollment, invite and claim, add-email, contractor/client data isolation, site↔company assignment, crew activation, expected-on-site, and the cross-company worker summary. (Earlier full run: 83/83 database tests pass.)
- **Code review** of every contractor-side screen and server action, plus the schema.
- **Probe:** confirmed how the portals behave when one person belongs to **more than one** company (§4, G1).
- **Not done:** a click-through of the screens in a browser. The tests prove the database rules and workflows, not the UI. A manual checklist is in §7.

---

## 3. What exists today

| Capability | Today | Where |
|---|---|---|
| Client brings in a contractor company | **Invite by contact email only.** Creates a stub company named `Invited: <email>`; the recipient registers, names the company and becomes its Contractor Admin. | `app/contractors/actions.ts`, `register/company` |
| Company is global, shared across clients | Yes — one `contractor_companies` record, linked to many orgs via `client_company_links`. | schema |
| Company profile | Legal name, contact name/email/phone, **trade types as a free-text comma list**, logo (column only). | `company/profile` |
| Company admin | Whoever accepts the company invite. `contractor_admin` is a role on `company_memberships`, separate from `worker`. **No UI** to add a second admin, change the admin, or have the org nominate one. | schema, `accept_company_invite` RPC |
| Workers | Contractor Admin adds workers (name, email, mobile), invites them, and tracks `Entered → Invited → Logged In → Account Created`. Soft-match on registration; one identity across companies. | `company/workers`, `register/worker` |
| Company ↔ facility | **Company-level** eligibility per site (`site_company_assignments`), then **worker-level** crew activation per site. | `app/sites`, `company/crew` |
| Worker profile | **Name, primary email, extra verified emails, mobile.** Nothing else. | `account/profile` |
| Orientation content | Generated, approved and published as versioned packages per site. Packages have **no title/description field**. Sites have `orientation_validity_months` (the expiry). | `orientation_packages`, `sites` |
| Orientation completions | **Not built** — designed in HowDesign-DataModel §3.4 (`orientation_completions`); lands in M3. | — |
| Credentials, experience | **Not built** — Certs Check is explicitly out of MVP scope (FunctionalOverview §9). | `CertsCheck.md` |

---

## 4. Gap analysis

Severity: **Blocker** = a requirement can't work without it · **Major** = new capability · **Minor** = refinement.

| # | Requirement | Gap | Severity |
|---|---|---|---|
| **G1** | Third-party admin across several companies; workers in several companies; people in both an org and a company | Every portal page finds "your company" / "your org" by fetching **one** membership row (`.maybeSingle()`, 33 call sites in 22 files). With 2+ memberships this returns *no data* (error PGRST116, confirmed by probe). Traced: a worker in **2 companies** is bounced to `/login` → `/app` → **"create an organization"**; a member of **2 orgs** hits an **infinite redirect loop** (`/app` ↔ create-org). Of the 33 lookups, 19 (in 15 files) are the "which one am I in" kind; the rest are legitimately scoped to one row. Already reachable today: `addWorker` links an existing user to a second company. | **Blocker** |
| **G2** | Org *defines* its contractor companies | Org can only send an email invite; it can't enter the company's name/details, and gets a stub named `Invited: <email>`. No duplicate detection when two orgs bring in the same company (it's a global record). | Major |
| **G3** | Org *assigns* the company admin (in-house / external / third party) | Admin = whoever accepts the invite. No nomination of an existing org user, no admin type, no second admin, no reassignment, no "managed by" (agency) concept. | Major |
| **G4** | Company capabilities | Free-text `trade_types`. No shared capability list, so capabilities can't be compared, filtered or mapped. | Major |
| **G5** | Company locations | None. | Major |
| **G6** | Location capabilities (default all, override per location) | None. | Major |
| **G7** | Map contractor locations to org facilities | Mapping is company → site. No location → site. | Major |
| **G8** | Where each worker works | Only crew activation on *client* sites. No home/base company location, no job title. | Major |
| **G9** | Worker work profile incl. LinkedIn | No job title, work phone, LinkedIn. | Minor |
| **G10** | Tickets, certificates, designations | None — and **out of scope today** (Certs Check). See decision D1. | Major + scope change |
| **G11** | Experience | None. | Major |
| **G12** | Orientation records on the profile (company, name, description, completed, expires) | No completion records yet (M3). Packages lack a **name and description**. | Major (depends on M3 data) |
| **G13** | Profile lists companies → orientations | No worker-facing "my companies / my orientations" view. | Major |
| **G14** | Who can see a worker's credentials and orientations | Undefined. Tenant isolation rules say cross-client reads only go through bridge tables; today another client sees only a *count* of a worker's companies (decision #6). See decision D5. | Major (design) |
| G15 | Test hygiene | 60 orphaned `public.users` rows left by test runs (auth users deleted, profiles not). The test script runs files in parallel and trips Supabase's sign-in rate limit on a fresh project. | Minor |

---

## 5. Decisions needed (with recommendations)

| # | Decision | Recommendation |
|---|---|---|
| **D1** ✅ confirmed | Tickets/certs/designations vs. the **Certs Check** exclusion | **Bring in a "credential wallet" now:** worker- or admin-entered records (type, name, issuer, number, issued, expiry, optional file). **Keep Certs Check's verification out of scope**: AI capture, per-site requirement matrices, compliance engine, scan integration. Update FunctionalOverview §9 accordingly. |
| **D2** ✅ confirmed | Where capabilities come from | A **platform-wide catalog** (seeded with common trades/services) that companies pick from, plus company-specific custom entries. Companies are global, so one shared list keeps them comparable across clients. |
| **D3** ✅ confirmed | Who owns the company record when an org "defines" it | Org creates the company **with its details** and nominates an admin. Before creating, **match existing companies** (name, business number, email domain) and link rather than duplicate. Once the company's admin exists, the company maintains its own profile; each org keeps **its own private notes/status** on the link. |
| **D4** | Location mapping vs. today's company → site eligibility | Add **location → site** links. A company counts as eligible for a site when at least one of its locations is mapped, so crew activation and "expected on site" keep working unchanged. |
| **D5** ✅ confirmed | Visibility of a worker's profile across clients | Worker sees everything. Their **company admins** see their profile, credentials and experience. A **client** sees credentials and experience for workers of companies linked to it, but **orientation records only for its own facilities** (other clients' orientations stay private — at most a count, as today). |
| **D6** | Orientation name/description source | Add `title` and `description` to the published package, pre-filled from the AI content model and editable in the approval editor. |
| **D7** | Historic/external orientation records (done before the platform) | **Defer.** Show platform completions only; revisit with bulk import later. |

---

## 6. Build plan

One feature per conversation, each with its own row-level security and tests (CLAUDE.md §5–§7). **F0 comes first because every later feature needs multi-company users.**

| # | Feature | Closes | Main changes | Done when |
|---|---|---|---|---|
| **F0** | **Multi-membership context** | G1 | "Current company / current org" selection (cookie), a switcher in the header, a small helper replacing the 33 `.maybeSingle()` lookups, and a landing page that routes people by their memberships. | A user in 2 companies + 1 org can switch between all three; existing 83 tests still pass; new test for multi-membership. |
| **F1** | **Org defines company + assigns admin** | G2, G3 | Org form: company details + admin nomination (existing org user / external email / third-party). Duplicate match before create. Multiple admins; add/remove admin; `admin_type` on the membership. | Org creates a company with details, nominates each admin type, and the nominee lands in the company portal; duplicates link instead of duplicating. |
| **F2** | **Capability catalog + company capabilities** | G4 | `capabilities` catalog (seeded) + `company_capabilities`. Replaces free-text trades (migrate existing values as custom entries). | Company picks capabilities; client can see and filter by them. |
| **F3** | **Company locations + per-location capabilities** | G5, G6 | `company_locations` (name, address, province, head-office flag). Per-location capabilities: **inherit all** by default, switch to a custom subset. | A new location shows all company capabilities; overriding one location doesn't affect others. |
| **F4** | **Location ↔ facility mapping** | G7 | `site_company_location_links`; client maps locations to its sites; company eligibility derived from it. Sites page + contractor page updated. | Mapping a location makes the company eligible for the site; crew activation still works; isolation tests extended. |
| **F5** | **Worker work profile** | G8, G9 | On the company membership: job title, work phone, **home/base location**. On the person: LinkedIn URL. Admin and worker can edit their parts. | Profile shows per-company title + base location; roster filterable by location. |
| **F6** | **Credential wallet + experience** | G10, G11 | `worker_credentials` (kind: ticket / certificate / designation; name, issuer, number, issued, expiry, optional file in private storage) and `worker_experience`. Expiry badge (valid / expiring / expired). Not verified — labelled "self-declared". | Worker and their admins add/edit records; visibility per D5 enforced by row-level security and tested. |
| **F7** | **Orientation records on the profile** | G12, G13 | Package `title`/`description` (D6). Build the `orientation_completions` table now (from the M3 design) so the profile has real data; M3's player writes into it later. Profile tab "Companies & orientations": client company → facility → orientation, completed, expires, status. | With seeded completions, a worker sees their records grouped by company; a client sees only its own. |
| **F8** | **Visibility hardening + cleanup** | G14, G15 | Cross-client visibility tests for every new table; purge orphaned test users; `--test-concurrency=1` in the test script. | Isolation suite covers all new tables; tests pass on a clean run. |

**Sequencing note:** M2 Step 5 (production wiring) is still open, and production currently points at the deleted database. It's small and independent, so it can be finished before or alongside F0. M3 (orientation player, quiz, QR) follows F7 and writes into the same completion records.

**Docs to update when D1–D7 are confirmed:** FunctionalOverview §3.2 and §9, HowDesign-DataModel §3.3–§3.4 (new tables), ExecutionPlan (insert this as a milestone before M3), then a Plan-Mode brief per feature as with M1/M2.

---

## 7. Manual click-through checklist (current build)

Run locally (`npm run dev` in `web/`). ConTrak currently has **Confirm email ON** — turn it off first, or new accounts can't sign in.

1. Register → create an organization → you're Client Admin.
2. **Sites:** add a site.
3. **Contractors:** invite a company by email → open the invite link (shown on screen in dev) → register the company → Company Profile: edit name, contacts, trades.
4. **Workers:** add a worker → Invite → open the link → register the worker.
5. **Sites:** assign the company to the site → **Crew:** activate the worker → **Sites:** the worker shows as expected on site.
6. **Expected gap (G1):** add that same worker's email to a *second* company → sign in as the worker → you're sent to "create an organization" instead of the contractor portal.
