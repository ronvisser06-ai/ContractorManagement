# Relatrix CRM integration (Plan-Mode Brief)

| | |
|---|---|
| **Status** | **Approved 2026-10-04** with Ron's answers to D-1 to D-4 (§7, which **revised §1, §3 and §5**). Nothing here is built yet. |
| **Decided with Ron (2026-10-04)** | Purpose: **both** the contractor network and ConTrak's own customers as a pipeline. Tenancy: **one Relatrix workspace, Ron's own**, one API client. |
| **Counterpart** | `ronvisser06-ai/RelatrixCRM`, `BUILD.md` §8 (the Planitize hand-off is the template), C10 (integration order), C17 (capabilities). |

---

## 1. The three questions (Rule 1)

**What exactly?** ConTrak pushes company-level facts to Relatrix so Ron has (A) a **master list of companies showing which companies use which vendors and contractors**, every one marked as coming from ConTrak, and (B) ConTrak's own customers, the client organizations, as deals on a separate **"ConTrak customers"** pipeline. Relatrix stays Ron's CRM and contacts database: ConTrak companies are **not** put on his main sales pipeline and **no people** cross; he adds a ConTrak company to the main pipeline by hand when it is appropriate. Relatrix is never the system of record for anything ConTrak enforces (orientations, QR, crew activation).

**Who for?** Ron, as the person who sells and supports ConTrak and wants one CRM across his products. Not for ConTrak's tenants: they never see Relatrix.

**What does done look like?** Creating a client org in ConTrak makes a company and a deal appear in Relatrix with a note saying where it came from; moving through ConTrak's lifecycle moves or annotates the deal; creating a contractor company (F1) first looks for an existing Relatrix company and links instead of duplicating; a capability picked in ConTrak (F2) arrives in Relatrix as a proposed capability fact. A Relatrix outage never blocks a ConTrak action, and a replayed sync never duplicates.

## 2. What was read

- ConTrak (`web/`, Next.js 14+, Drizzle, Supabase, **Inngest** already installed): `contractor_companies` is **global** (legalName, tradeTypes text[], contact name/email/phone, status); `organizations` are clients; `client_company_links` joins them; `company_memberships` and `site_worker_activations` hold workers (PII). M2.5 is mid-way: F0 shipped, **F1 (org defines company + admin, with match-before-create) is next**, F2 adds a capability catalog.
- Relatrix API today (BUILD.md §6.3): companies, contacts, pipelines (read only), deals with `POST /deals/:id/stage`, activities, relationships, a contact's emails/phones/jobs. Keys are scoped, requests carry `Idempotency-Key`, lists filter by `external_ref[<app>]`, and `external_refs` is a writable map on companies, contacts and deals.
- **Relatrix API gaps this needs** (found, not assumed): no capability, vocabulary, certification or profile endpoints (planned in Phase 2, not built); the company list cannot be filtered by name or domain, only by `external_ref`; no `/search`.

## 3. What crosses, and what never does (revised by D-3)

| Crosses | Never crosses |
|---|---|
| Every company ConTrak knows, client or contractor: legal name, domain if known, trade types / capabilities | Workers: their names, emails, phones, credentials, crew assignments (PII) |
| **Who uses whom:** a client organization → contractor company relationship, as a Relatrix relationship edge | The contractor's or client's business contact **as a Relatrix contact** (D-3: Relatrix's contacts stay Ron's own) |
| **Where it came from:** the tag `contrak` and the company field `source = ConTrak`, set on every company ConTrak creates (D-4) | A client's private notes or status on a contractor link |
| Client org lifecycle: a deal on "ConTrak customers" and activities on it (D-1, D-2) | Orientation content, completions, QR data, scan logs |

**This reverses the earlier draft's last rule.** The first draft kept "which client uses which contractor" out of Relatrix to protect tenant isolation. Ron wants exactly that list, as the operator of the platform and the owner of the CRM. It is a deliberate platform-operator view: it never reaches another tenant, but a client should be told that Visser Solutions can see which contractors it uses. **Flag for the privacy notice and customer terms before real clients are live** (not a build blocker; a go-live one).

A ConTrak company that Ron also deals with commercially is the same Relatrix company: it enters as a plain company with the flag, and he later puts it on the main pipeline himself. ConTrak never creates a deal on any pipeline but "ConTrak customers".

## 4. Design

- **One API client, "Contractor Management"**, in Ron's workspace; key in ConTrak's server env only (`RELATRIX_BASE_URL`, `RELATRIX_API_KEY`), never in the browser. Scopes `companies:read/write`, `deals:read/write`, `activities:write`, `pipelines:read`, and later `capabilities:read/write`.
- **Outbound only in v1.** No Relatrix webhook into ConTrak. (A later slice can send Relatrix `company.updated` back; not needed for the goal.)
- **Never blocks the user.** A ConTrak action writes its own data and one `crm_sync` row (entity, entity id, desired payload hash, status, attempts, last error) in the same transaction; an **Inngest** function drains it with backoff. A failed sync is visible, retried, and harmless.
- **Idempotent.** Every Relatrix write carries `Idempotency-Key: contrak-<entity>-<id>-<payload hash>`; a company is found by `external_ref[contrak]=<id>` before anything is created, so a replay or a backfill cannot duplicate.
- **Never overrides a person.** ConTrak stores the stage it last put a deal in. It moves a deal only if the deal is still there; if Ron moved it, ConTrak writes an activity instead. This is the same rule as Planitize's echo suppression, from the other side.
- **Relationships, not contacts.** "Client org uses contractor" is a company-to-company relationship edge of a workspace-defined type (Ron creates **"Uses contractor"** in Relatrix Settings; ConTrak looks it up by key and refuses to sync, loudly, if it is missing, because the API cannot create types). One edge per link, found by `external_ref`, ended (not deleted) when the link is.
- **Link both ways.** ConTrak keeps `relatrix_company_id` (and a deal id for customers); Relatrix keeps `external_refs.contrak` / `contrak_org`.
- **No new dependency** (the stack is locked, CLAUDE.md §3): a small typed `fetch` client in `web/src/lib/relatrix/`, validated with the schemas ConTrak already uses, not the Relatrix package (it is private and generated).
- **Schema changes to flag (CLAUDE.md §6):** `crm_sync` table (service-role only, RLS on, no client policy); `relatrix_company_id` on `contractor_companies`; `relatrix_company_id` and `relatrix_deal_id` on `organizations`. All additive, with Drizzle migrations.

## 5. Slices (one at a time, Rule 6)

Ordered so the unblocked work ships first and nothing waits on a repo it does not need.

| # | Where | Slice | Needs | Done when |
|---|---|---|---|---|
| **S1** ✅ | ConTrak | Foundations: Relatrix client, `crm_sync`, Inngest drain with backoff, health check, `--dry-run`, fake-Relatrix test server | nothing | A queued sync is delivered once, retried on a 5xx, abandoned loudly on a 4xx, and a replay is a no-op. |
| **S2** ✅ | ConTrak | **Customers pipeline:** a new client org becomes a Relatrix company (tag `contrak`, source ConTrak) + a deal on **"ConTrak customers"**; Signed up → Onboarding (first site) → Live (first package published) → Adopting (first contractor invited) | S1; Ron creates the pipeline and its four stages in Relatrix | Creating an org in ConTrak shows the company and deal in Relatrix; a milestone moves the deal unless Ron already did. |
| **S3** ✅ | Relatrix | API gaps: expose `source` and `tags` on companies (write and filter), company list filters `name` and `domain`, capability and vocabulary endpoints with scopes, proofs, OpenAPI + client regenerated; and a **Companies list filter by source/tag** so Ron can see "from ConTrak" at a glance | nothing | A key can create a company with source ConTrak and the tag; Ron's company list filters to them; a key without `capabilities:write` is refused. |
| **S4** ✅ | ConTrak | **Network sync with match-before-create:** F1's "create company" asks Relatrix by `external_ref`, then domain, then name; links instead of duplicating; contractor companies get the tag and source; **client→contractor "uses" relationships** are synced | S1, S3, ConTrak **F1 landed**, Ron's "Uses contractor" type | Two orgs bringing in the same company converge on one Relatrix company, each with a "uses" edge. |
| **S5** | ConTrak | **Capabilities:** F2's catalog terms become a ConTrak-defined vocabulary in Relatrix; picks become proposed capability facts | S3, ConTrak **F2 landed** | A capability picked in ConTrak is waiting in Relatrix's Review with its source. |
| **S6** | ConTrak | Backfill: existing companies, orgs and links, dry-run first (**orgs built 2026-10-04**; contractor companies and links wait for S4) | S2, S4 | The dry run lists exactly what would be sent; the real run is resumable. |

S2 before S3 on purpose: it needs only endpoints that exist, **except** that the tag and source cannot be set through the API today (see S3). S2 therefore sets them with a `notes` marker and `external_refs` only, and S3 upgrades them; or S3's two small additions (`source`, `tags`) are pulled ahead of S2. **Decision for the build: pull them ahead as slice S2a in Relatrix**, so S2 ships with the real flag. **S2a is built (2026-10-04, RelatrixCRM `BUILD.md` §6.4):** `source = contrak` (a new value in a closed list, companies only), tags, and the `source=` / `tag=` list filters, plus Companies → From ConTrak in the app. Not yet applied to the hosted Relatrix project.

## 6. Risks and what cannot be proven from here

- **ConTrak's tests run against the production database** (BUILDLOG, 2026-09-30: "Tests run against production"; a separate dev/test project is the stated next step). New tests for S1 are written to need **no database** (mapping, matching, idempotency, retry against a fake server). A test that writes to the database waits for the dev project, or for Ron's explicit go-ahead.
- **Relatrix is not live.** Its Phase 2–3 migrations, the `relatrix_api` role and Vercel env are unapplied (`docs/go-live.md` in that repo). Everything is proven against a fake Relatrix over HTTP; the first real sync is Ron's, after go-live.
- **Two products' shapes drift.** The fake server is generated from Relatrix's own OpenAPI document (`/api/v1/openapi.json`) so a field rename there fails ConTrak's tests, not production.
- **Deal currency has no default in Relatrix (C8).** Customer deals are created in CAD with no value until Ron says otherwise.

## 7. Decisions (recorded 2026-10-04)

| # | Decision | Ron's answer |
|---|---|---|
| **D-1** | Which pipeline holds ConTrak customers | A new one, **"ConTrak customers"**. |
| **D-2** | Which ConTrak events move a deal | Org created → *Signed up*; first site added → *Onboarding*; first orientation package published → *Live*; first contractor invited → *Adopting*. |
| **D-3** | Does a contractor's business contact become a Relatrix contact | **No for v1** (PII ConTrak collected for orientation). Instead: a **master company list in Relatrix showing which companies use which vendors/contractors**, kept apart from Relatrix's contacts. ConTrak companies are added to the main pipeline **manually** when appropriate, and must be recognisable as ConTrak-sourced: **a `#ConTrak` flag and a `Source` field**. |
| **D-4** | Tag contractor companies `contrak` | **Yes.** |

Open, small: the exact spelling of the flag and field in Relatrix (proposed: tag `contrak`, company field Source = `ConTrak`), and the type name **"Uses contractor"**.

## 8. Not in this brief

Inbound sync from Relatrix; per-client Relatrix connections (decided against: one workspace); workers, credentials and orientation records in Relatrix; Casa Cabana and FriendSay.

**S1 built (2026-10-04, BUILDLOG):** `web/src/lib/relatrix/`, migration `0018_crm_sync.sql`, the `drain-crm-sync` Inngest function and `/api/health/relatrix`. Off by default; nothing queues a sync until S2/S4. Migration not yet applied to production.
**S2 built (2026-10-04, BUILDLOG):** a client org becomes a flagged company and a deal on "ConTrak customers"; milestones move it forward only, never over a person; set-up problems block with an instruction. Needs Ron to create the pipeline and its four stages.

**S3 built (2026-10-05, RelatrixCRM `BUILD.md` §6.5):** `GET /companies?name=&domain=` (whole-name, case-insensitive, over name, legal name and aliases; primary or any domain) for S4's match-before-create; a `capabilities:read` / `capabilities:write` scope group; vocabularies and terms (`/vocabularies`, `/vocabularies/{id}/terms`, retire a term, never delete); and `POST /companies/{id}/capabilities`, which **proposes** a capability as a fact for Review and answers with what is already there or waiting instead of writing twice. ConTrak's key needs `capabilities:read capabilities:write` added for S5. Not applied to the hosted Relatrix.

**S4 built (2026-10-02):** `link.uses` sync (`web/src/lib/relatrix/ops.ts`, `links.ts`). Per client→contractor link it makes sure both companies are in Relatrix, then keeps one `uses-contractor` edge. Contractors match by ConTrak id, then **website domain** (derived from the contact's work email; a mailbox-provider address gives none, and only the domain leaves), then name; a match is adopted (tag + id added, name and source untouched), several matches block the sync and say so. Two ConTrak records for one real company share one Relatrix company. An invited link makes no edge; suspended ends it; reactivated brings it back. Hooks: invite, defining a company, accepting an invitation, accepting a link, and editing the company profile. **Trade types do not cross yet** (they are free text; S5 sends capabilities). **Ron must** create the type (`uses-contractor`, company to company) and add `relationships:read relationships:write` to the key. The S6 backfill covers links too (`--links`).

**S6 for links built (2026-10-02):** `scripts/backfill-relatrix.mjs --links` (plan by default, `--queue`, `--limit`, `--only` by organization or link id, `--skip`, `--status`), `lib/relatrix/backfill-links.ts`. It queues the same `link.uses` payload the live hooks do, oldest link first, so the drain sends it (both companies matched before created, then the edge). Nothing is queued twice, and live mode refuses without `--yes`. Run it after the organization backfill and after Ron has made the "Uses contractor" type.
