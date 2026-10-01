# Relatrix CRM integration (Plan-Mode Brief)

| | |
|---|---|
| **Status** | **Proposed 2026-10-04**, awaiting Ron's approval of §7. Nothing here is built. |
| **Decided with Ron (2026-10-04)** | Purpose: **both** the contractor network and ConTrak's own customers as a pipeline. Tenancy: **one Relatrix workspace, Ron's own**, one API client. |
| **Counterpart** | `ronvisser06-ai/RelatrixCRM`, `BUILD.md` §8 (the Planitize hand-off is the template), C10 (integration order), C17 (capabilities). |

---

## 1. The three questions (Rule 1)

**What exactly?** ConTrak pushes company-level facts to Relatrix so Ron can see them there: (A) every contractor company ConTrak knows, with its capabilities; (B) every client organization that uses ConTrak, as a customer on a sales pipeline. Relatrix is never the system of record for anything ConTrak enforces (orientations, QR, crew activation).

**Who for?** Ron, as the person who sells and supports ConTrak and wants one CRM across his products. Not for ConTrak's tenants: they never see Relatrix.

**What does done look like?** Creating a client org in ConTrak makes a company and a deal appear in Relatrix with a note saying where it came from; moving through ConTrak's lifecycle moves or annotates the deal; creating a contractor company (F1) first looks for an existing Relatrix company and links instead of duplicating; a capability picked in ConTrak (F2) arrives in Relatrix as a proposed capability fact. A Relatrix outage never blocks a ConTrak action, and a replayed sync never duplicates.

## 2. What was read

- ConTrak (`web/`, Next.js 14+, Drizzle, Supabase, **Inngest** already installed): `contractor_companies` is **global** (legalName, tradeTypes text[], contact name/email/phone, status); `organizations` are clients; `client_company_links` joins them; `company_memberships` and `site_worker_activations` hold workers (PII). M2.5 is mid-way: F0 shipped, **F1 (org defines company + admin, with match-before-create) is next**, F2 adds a capability catalog.
- Relatrix API today (BUILD.md §6.3): companies, contacts, pipelines (read only), deals with `POST /deals/:id/stage`, activities, relationships, a contact's emails/phones/jobs. Keys are scoped, requests carry `Idempotency-Key`, lists filter by `external_ref[<app>]`, and `external_refs` is a writable map on companies, contacts and deals.
- **Relatrix API gaps this needs** (found, not assumed): no capability, vocabulary, certification or profile endpoints (planned in Phase 2, not built); the company list cannot be filtered by name or domain, only by `external_ref`; no `/search`.

## 3. What crosses, and what never does

| Crosses | Never crosses |
|---|---|
| Contractor company: legal name, trade types / capabilities, status | Workers, their emails, phones, credentials, crew assignments (PII) |
| Client org: name, created date, lifecycle milestones | A client's private notes or status on a contractor link |
| Capability terms picked from ConTrak's catalog (as proposed facts) | Orientation content, completions, QR data, scan logs |
| The company's published business contact (**decision D-3**) | Which client uses which contractor (one client's relationships are another's competitive data) |

The last row matters: Relatrix is Ron's, but ConTrak's tenant isolation is a promise to each client. A contractor company appearing in Relatrix must not reveal that it works for a particular client.

## 4. Design

- **One API client, "Contractor Management"**, in Ron's workspace; key in ConTrak's server env only (`RELATRIX_BASE_URL`, `RELATRIX_API_KEY`), never in the browser. Scopes `companies:read/write`, `deals:read/write`, `activities:write`, `pipelines:read`, and later `capabilities:read/write`.
- **Outbound only in v1.** No Relatrix webhook into ConTrak. (A later slice can send Relatrix `company.updated` back; not needed for the goal.)
- **Never blocks the user.** A ConTrak action writes its own data and one `crm_sync` row (entity, entity id, desired payload hash, status, attempts, last error) in the same transaction; an **Inngest** function drains it with backoff. A failed sync is visible, retried, and harmless.
- **Idempotent.** Every Relatrix write carries `Idempotency-Key: contrak-<entity>-<id>-<payload hash>`; a company is found by `external_ref[contrak]=<id>` before anything is created, so a replay or a backfill cannot duplicate.
- **Never overrides a person.** ConTrak stores the stage it last put a deal in. It moves a deal only if the deal is still there; if Ron moved it, ConTrak writes an activity instead. This is the same rule as Planitize's echo suppression, from the other side.
- **Link both ways.** ConTrak keeps `relatrix_company_id` (and a deal id for customers); Relatrix keeps `external_refs.contrak` / `contrak_org`.
- **No new dependency** (the stack is locked, CLAUDE.md §3): a small typed `fetch` client in `web/src/lib/relatrix/`, validated with the schemas ConTrak already uses, not the Relatrix package (it is private and generated).
- **Schema changes to flag (CLAUDE.md §6):** `crm_sync` table (service-role only, RLS on, no client policy); `relatrix_company_id` on `contractor_companies`; `relatrix_company_id` and `relatrix_deal_id` on `organizations`. All additive, with Drizzle migrations.

## 5. Slices (one at a time, Rule 6)

Ordered so the unblocked work ships first and nothing waits on a repo it does not need.

| # | Where | Slice | Needs | Done when |
|---|---|---|---|---|
| **S1** | ConTrak | Foundations: Relatrix client, `crm_sync`, Inngest drain with backoff, health check, `--dry-run`, fake-Relatrix test server | nothing | A queued sync is delivered once, retried on a 5xx, abandoned loudly on a 4xx, and a replay is a no-op. |
| **S2** | ConTrak | **Customers pipeline:** a new client org becomes a Relatrix company + a deal on a pipeline; lifecycle milestones move or annotate it | S1; Ron's pipeline and stages (**D-1, D-2**) | Creating an org in ConTrak shows the company and deal in Relatrix; a milestone moves the deal unless Ron already did. |
| **S3** | Relatrix | API gaps: company list filters (`name`, `domain`), capability and vocabulary endpoints with scopes, proofs, OpenAPI + client regenerated | nothing | A key with `capabilities:write` proposes a capability fact for a company; a key without it is refused. |
| **S4** | ConTrak | **Network sync with match-before-create:** F1's "create company" first asks Relatrix by `external_ref`, then domain, then name; links instead of duplicating | S1, S3, and ConTrak **F1 landed** | Two orgs bringing in the same company converge on one Relatrix company. |
| **S5** | ConTrak | **Capabilities:** F2's catalog terms become a ConTrak-defined vocabulary in Relatrix; company picks become proposed capability facts | S3, ConTrak **F2 landed** | A capability picked in ConTrak is waiting in Relatrix's Review with its source. |
| **S6** | ConTrak | Backfill: existing companies and orgs, dry-run first, then real | S2, S4 | The dry run lists exactly what would be sent; the real run is resumable. |

S2 before S3 on purpose: it needs only endpoints that exist. S4 and S5 wait on ConTrak's own F1 and F2 so this does not fork their work.

## 6. Risks and what cannot be proven from here

- **ConTrak's tests run against the production database** (BUILDLOG, 2026-09-30: "Tests run against production"; a separate dev/test project is the stated next step). New tests for S1 are written to need **no database** (mapping, matching, idempotency, retry against a fake server). A test that writes to the database waits for the dev project, or for Ron's explicit go-ahead.
- **Relatrix is not live.** Its Phase 2–3 migrations, the `relatrix_api` role and Vercel env are unapplied (`docs/go-live.md` in that repo). Everything is proven against a fake Relatrix over HTTP; the first real sync is Ron's, after go-live.
- **Two products' shapes drift.** The fake server is generated from Relatrix's own OpenAPI document (`/api/v1/openapi.json`) so a field rename there fails ConTrak's tests, not production.
- **Deal currency has no default in Relatrix (C8).** Customer deals are created in CAD with no value until Ron says otherwise.

## 7. Decisions needed from Ron

| # | Decision | Recommendation |
|---|---|---|
| **D-1** | Which Relatrix pipeline holds ConTrak customers? | A new pipeline "ConTrak customers", so it does not mix with consulting deals. |
| **D-2** | Which ConTrak events map to which stage? | Org created → *Signed up*; first site added → *Onboarding*; first orientation package published → *Live*; first contractor invited → *Adopting*. Four stages, forward only. |
| **D-3** | Does a contractor company's published business contact (name, email, phone) become a Relatrix contact? | **No in v1.** Company only. A person's name and email is PII ConTrak collected for orientation, and the CRM does not need it to know the company exists. Revisit once consent wording is settled. |
| **D-4** | A contractor company's status in Relatrix | Add the tag `contrak`; do not mirror ConTrak's `status`. |

## 8. Not in this brief

Inbound sync from Relatrix; per-client Relatrix connections (decided against: one workspace); workers, credentials and orientation records in Relatrix; Casa Cabana and FriendSay.
