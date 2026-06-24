# How Design — Data Model, Access Control & Identity

## Document Information

| Field | Value |
|-------|-------|
| **Document** | HowDesign-DataModel.md |
| **Version** | 1.1.0 |
| **Status** | Draft for review |
| **Last Updated** | 2026-06-23 |
| **Revision note** | v1.1.0 reflects the design-rationalization deep dive (DesignRationalization.md): per-worker QR (`qr_proofs` keyed by worker), `site_worker_activations`, `orientation_lockouts`, expanded notification events, SMS invitation channel, and identity soft-match/merge. |
| **Layer** | First "How" design area. Siblings to follow: generation pipeline (see orientation_pipeline_contracts_v0.1.md), QR & verification security, notifications/eventing, media handling, environments & testing. |
| **Companion docs** | FunctionalOverview.md (the "What"), ExecutionPlan.md (sequencing & stack), orientation_pipeline_contracts_v0.1.md (job/package contracts). |
| **Unblocks** | Milestone M0 (core schema + RLS). |

> Stack context (locked in ExecutionPlan.md §2): Postgres via Supabase, with Row-Level Security as the enforcement layer; Drizzle for schema/migrations; Supabase Auth for identity. This document specifies the field-level model, the access rules, and the identity design that the rest of the build sits on.

---

## 1. Foundational principle: three data domains

Data is partitioned into three domains, each with distinct ownership and visibility rules. This replaces the simpler "scope everything by `org_id`" model, which cannot express cross-tenant contractors.

| Domain | Ownership | Isolation rule |
|--------|-----------|----------------|
| **Client** | Owned by exactly one client organization | Strict tenant isolation by `org_id` |
| **Contractor** | Global — owned by no client | Visible to own members + the *slice* exposed to linked clients |
| **Bridge** | A relationship *between* a client and a contractor | Visible to both sides of that specific relationship only |

Every table below is tagged with its domain. The bridge domain is the security pivot: it is what lets a Client Admin see a worker's completion for *their* site while never seeing that worker's history with another client.

---

## 2. Identity model

- **One person = one `users` row = one login.** Joining another company or working for another client never creates a second identity.
- **A user may hold many verified email addresses.** A worker often first appears as an invite to `john@company-a.com`, then later is invited as `john@company-b.com`. The worker consolidates by adding and verifying the second email on their existing account; that action links the second company membership (and its `contractor_ref`) to the one identity. The act of adding/verifying the email is the consent event (decision #5b) and produces a clean audit trail.
- **Roles are scoped to a context, not global** (decision #2). Client-side roles attach to an `org_membership`; contractor-side roles attach to a `company_membership`. Roles are additive within and across contexts.
- **Worker ↔ company is many-to-many** (decision #3) via `company_memberships`.

### ID & key conventions
- `users.id` is the **Supabase Auth UUID** (so `auth.uid()` maps directly in RLS). All other entities use **prefixed ULIDs** (`org_`, `site_`, `cco_`, `pkg_`, `cmp_`, `qrp_`, `inv_`, `ast_`, …), consistent with orientation_pipeline_contracts_v0.1.md.
- All timestamps are `timestamptz` (UTC). Emails stored as `citext` (case-insensitive, unique).

---

## 3. Field-level schema

### 3.1 Identity (contractor domain + shared)

**users**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | = Supabase Auth uid |
| given_name | text | |
| family_name | text | |
| primary_email | citext | Convenience denormalization; canonical set in `user_emails` |
| mobile | text? | |
| photo_asset_id | ULID? (FK assets) | Optional; supports QR visual verification (risk register) |
| status | enum `user_status` | active, disabled |
| created_at / updated_at | timestamptz | |

**user_emails**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| user_id | uuid (FK users) | |
| email | citext (unique) | |
| is_primary | bool | exactly one true per user |
| verified_at | timestamptz? | null until verified |
| added_at | timestamptz | |

### 3.2 Client domain (isolated by `org_id`)

**organizations**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID `org_` (PK) | tenant root |
| name | text | |
| status | enum | active, suspended |
| settings | jsonb | org defaults (e.g. fallback validity period) |
| created_at / updated_at | timestamptz | |

**sites**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID `site_` (PK) | |
| org_id | ULID (FK organizations) | |
| name | text | |
| address | jsonb? | |
| province | text? | harmless now; supports future jurisdiction logic |
| orientation_validity_months | int? | per-site expiry default (decision #6); null → org default |
| active_package_id | ULID? (FK orientation_packages) | the one active orientation (decision: one per site) |
| created_at / updated_at | timestamptz | |

**org_memberships**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| user_id | uuid (FK users) | |
| org_id | ULID (FK organizations) | |
| roles | enum[] `org_role` | client_admin, content_developer, content_approver, foreman (additive) |
| status | enum | invited, active, disabled |
| created_at | timestamptz | |
| | | unique (user_id, org_id) |

**site_foremen**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| user_id | uuid (FK users) | must hold `foreman` role in the site's org |
| site_id | ULID (FK sites) | |
| assigned_at | timestamptz | |
| | | unique (user_id, site_id) |

**orientation_packages** — published artifact of the generation pipeline; see orientation_pipeline_contracts_v0.1.md §4.6 for the canonical shape. Platform-side columns:

| Column | Type | Notes |
|--------|------|-------|
| id | ULID `pkg_` (PK) | |
| org_id / site_id | ULID (FK) | |
| version | int | |
| supersedes_id | ULID? (FK self) | |
| content_model_ref | jsonb | {storage_key, sha256} |
| quiz_ref | jsonb | {storage_key, sha256} |
| asset_manifest | jsonb | |
| content_hash | text | completions pin to this |
| requalification_policy | enum | full, new_content_only, none (decision #7 of "What") |
| qa_flagged | bool | |
| status | enum | published, archived |
| approved_by | uuid (FK users) | must hold `content_approver` |
| approved_at / published_at / created_at | timestamptz | |

**generation_jobs** — authoritative schema lives in orientation_pipeline_contracts_v0.1.md §2. Flat indexable columns (`id`, `org_id`, `site_id`, `status`, `current_stage`, `rework_count`, `max_rework`, `qa_flagged`, `package_id`, `created_by`, timestamps, `idempotency_key`); `artifacts`, `qa_history`, `telemetry`, `error` as `jsonb`. Client domain, isolated by `org_id`.

### 3.3 Contractor domain (global, NOT org-scoped)

**contractor_companies**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID `cco_` (PK) | global entity |
| legal_name | text | |
| trade_types | text[] | work-type classification |
| contact_name / contact_email / contact_phone | text | |
| logo_asset_id | ULID? (FK assets) | |
| status | enum | active, disabled |
| created_at / updated_at | timestamptz | |

**company_memberships** — a worker or admin in a company (M:N); also holds the per-enrollment lifecycle

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| user_id | uuid (FK users) | |
| company_id | ULID (FK contractor_companies) | |
| roles | enum[] `company_role` | contractor_admin, worker |
| contractor_ref | text? | the company's own worker ID ("ContractorID", decision #5) |
| onboarding_status | enum | entered, invited, logged_in, account_created |
| invited_email | citext? | which email the invite targeted (resolves to `user_emails`) |
| status | enum | active, disabled |
| created_at / updated_at | timestamptz | |
| | | unique (user_id, company_id) |

### 3.4 Bridge domain (relationship-scoped)

**client_company_links** — a client has invited/works with a contractor company

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| org_id | ULID (FK organizations) | |
| company_id | ULID (FK contractor_companies) | |
| status | enum | invited, active, suspended |
| invited_at / accepted_at / created_at | timestamptz | |
| | | unique (org_id, company_id) |

**site_company_assignments** — drives "expected on site"

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| site_id | ULID (FK sites) | |
| company_id | ULID (FK contractor_companies) | requires an active client_company_link |
| status | enum | active, removed |
| assigned_at | timestamptz | |
| | | unique (site_id, company_id) |

**site_worker_activations** — crew dispatch; which workers are actually active on a site (revised v1.1, decision #14)

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| site_id | ULID (FK sites) | |
| company_id | ULID (FK contractor_companies) | |
| user_id | uuid (FK users) | the worker; must be a worker member of the company |
| status | enum | active, removed |
| activated_by | uuid (FK users) | the Contractor Admin |
| activated_at | timestamptz | |
| | | unique (site_id, user_id) |

> The foreman's on-site list and the site's compliance denominator are based on **active** activations, not on every worker of every assigned company. Company assignment establishes *eligibility*; activation establishes *who is actually here*.

**orientation_lockouts** — a worker who exhausted attempts for a site's orientation (revised v1.1, decision #17)

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| user_id | uuid (FK users) | |
| site_id | ULID (FK sites) | |
| package_id | ULID (FK orientation_packages) | the version they locked out on |
| locked_at | timestamptz | |
| active | bool | false once reset |
| reset_by | uuid? (FK users) | foreman or client_admin |
| reset_at | timestamptz? | |
| | | partial unique (user_id, site_id) where active |

**orientation_completions**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID `cmp_` (PK) | |
| user_id | uuid (FK users) | the worker |
| site_id | ULID (FK sites) | |
| org_id | ULID (FK organizations) | denormalized (site's org) for RLS/index |
| package_id | ULID (FK orientation_packages) | the version completed |
| content_hash | text | pinned snapshot |
| score | numeric | |
| passed | bool | |
| attempt_count | int | |
| completed_at | timestamptz | |
| expires_at | timestamptz | computed from site validity at completion |
| is_current | bool | one current per (user, site) |
| status | enum | active, expired, superseded |
| created_at | timestamptz | |

**quiz_attempts**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| user_id / site_id / package_id | FK | |
| attempt_number | int | enforces max-attempts |
| score | numeric | |
| passed | bool | |
| answers | jsonb | for question-level analytics |
| started_at / submitted_at | timestamptz | |

**qr_proofs** — one permanent pointer **per worker** (revised v1.1; was per worker × client × site)

| Column | Type | Notes |
|--------|------|-------|
| id | ULID `qrp_` (PK) | |
| user_id | uuid (FK users) | |
| token | text (unique) | **hashed at rest** (raw token only in the QR image); opaque, unguessable |
| status | enum | active, reissued_superseded |
| created_at | timestamptz | |
| | | unique (user_id) — one live QR per worker |

> Resolution is **worker-centric**: the token identifies the worker; the scanning foreman's active site determines which completion is evaluated. Validity (active/expired/revoked/incomplete) is **never stored** on the QR; it is computed live at scan time from the worker's current completion for the foreman's site + revocations. Full token scheme and the verification flow are in HowDesign-QRVerification.md.

**qr_scans**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| qr_proof_id | ULID (FK qr_proofs) | |
| scanned_by | uuid (FK users) | foreman |
| site_id | ULID (FK sites) | the foreman's **active site** the status was resolved for |
| result | enum | active, expired, revoked, incomplete, not_found |
| device_meta | jsonb? | optional |
| scanned_at | timestamptz | |

**access_revocations**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| user_id | uuid (FK users) | worker |
| org_id | ULID (FK organizations) | |
| scope | enum | site, org_wide (decision #8) |
| site_id | ULID? (FK sites) | null when org_wide |
| reason | text? | |
| active | bool | revocation can be lifted |
| revoked_by | uuid (FK users) | |
| revoked_at | timestamptz | |

**invitations**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID `inv_` (PK) | |
| type | enum | company, worker, org_user |
| token | text (unique) | single-use |
| channel | enum | email, sms (revised v1.1) |
| email | citext? | target when channel = email |
| phone | text? | target when channel = sms (magic-link) |
| org_id | ULID? | company / org_user invites |
| company_id | ULID? | worker invites |
| intended_roles | enum[] | role(s) granted on accept |
| status | enum | pending, accepted, expired, revoked |
| expires_at | timestamptz | |
| created_by | uuid (FK users) | |
| accepted_user_id | uuid? (FK users) | set on reconciliation |
| created_at / accepted_at | timestamptz | |

### 3.5 Shared — media & notifications

**assets**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID `ast_` (PK) | |
| kind | enum | image, video, pdf, logo |
| storage_key | text | object storage key |
| mime | text | |
| sha256 | text | |
| width / height / bytes | int? | |
| created_at | timestamptz | (encryption-at-rest, signed-URL resolution are infra concerns) |

**notifications**

| Column | Type | Notes |
|--------|------|-------|
| id | ULID (PK) | |
| user_id | uuid (FK users) | recipient |
| event_type | enum | company_invited, worker_invited, signin_link, orientation_completed, qr_issued, requalification_required, requalification_summary, worker_locked_out, expiring_30, expiring_14, expiring_7, expired, access_revoked |
| channel | enum | email, sms |
| payload | jsonb | |
| status | enum | queued, sent, failed |
| created_at / sent_at | timestamptz | |

---

## 4. Access control (Row-Level Security)

RLS is enforced in Postgres against `auth.uid()`. Policies are **relationship-derived**, not flat tenant filters. Two helper sets (implemented as `SECURITY DEFINER` SQL functions, marked `STABLE`) underpin everything:

```sql
-- orgs where the caller has any active membership
user_org_ids(uid)      -> set<org_id>
-- companies where the caller has any active membership
user_company_ids(uid)  -> set<company_id>
-- orgs linked (via client_company_links) to any of the caller's companies
user_linked_org_ids(uid) -> set<org_id>
-- companies linked to any of the caller's orgs
org_linked_company_ids(uid) -> set<company_id>
```

### 4.1 Client-domain policies
Read: `org_id IN user_org_ids(auth.uid())`. Write gated by role within that org:

| Action | Required role in org |
|--------|----------------------|
| Create/edit sites, assign orientations, set validity, revoke access | client_admin |
| Create/edit orientation drafts (jobs) | content_developer |
| Approve & publish a package | content_approver |
| Scan / view foreman dashboard | foreman (scoped to assigned sites) |

### 4.2 Contractor-domain policies
- `contractor_companies` / `company_memberships`: readable if `company_id IN user_company_ids(auth.uid())` **(own members)** OR `company_id IN org_linked_company_ids(auth.uid())` **(linked clients — limited slice)**.
- A worker's profile (`users`, `user_emails`) is readable by: themselves; admins of a company they belong to; and a client org only through a bridge row tying that worker to one of the org's sites.
- Writes to a company/worker record are limited to that company's `contractor_admin` (and the worker editing their own profile).

### 4.3 Bridge-domain policies
A row is visible if the caller is on **either** side of the relationship:

```
visible(completion) :=
     user_id = auth.uid()                                  -- the worker
  OR worker_company_of(user_id) ∩ user_company_ids(auth.uid()) ≠ ∅   -- their company admin
  OR org_id IN user_org_ids(auth.uid())                    -- the site's client (admin/foreman)
```
Foreman reads are further narrowed to `site_id IN (their site_foremen rows)`. `qr_scans`, `qr_proofs`, `access_revocations`, and `orientation_completions` follow the same pattern. Writes: completions/QR are written by the system (service role) on pass; revocations by `client_admin`; scans by `foreman`.

### 4.4 Cross-company worker view (decision #6)
A deliberate, narrow exception to slice-isolation. Exposed via a view/function, not raw table access:

```
worker_company_summary(worker_user_id, viewer) ->
  { total_company_count: <count of all active company_memberships>,   -- count only
    shared_companies:    [companies that ALSO have a client_company_link
                          with one of the viewer's orgs] }            -- names only for shared
```
The viewer (Client Admin or Foreman) always sees the **count**, but **names only** for companies that also work with their own client. The full cross-client picture is never exposed.

### 4.5 "Expected on site" (decision #7, revised v1.1 per decision #14)
Derived view for MVP; materialize only if foreman-list latency requires it. The on-site list is the **activated** crew, not every employee of every assigned company:

```
expected_on_site(site_id) :=
  workers (user_id) in site_worker_activations(site_id, status=active)
```
`site_company_assignments` still governs *eligibility* (a worker can only be activated for a site whose company is assigned); `site_worker_activations` governs *presence*. The compliance denominator for a site uses the same activated set.

---

## 5. Identity reconciliation flow (decision #5b)

```
1. Company Admin invites worker by email OR SMS → invitations row (type=worker, token, channel, email/phone, company_id)
                                                 → company_memberships (onboarding_status=invited, invited_email/phone)
2. Recipient opens the tokenized link (email link or SMS magic-link).
3a. Contact matches an existing verified user_emails (or user mobile) row
        → prompt the signed-in/registering worker to ACCEPT joining this company
        → on accept: link company_membership.user_id to the existing identity,
          attach contractor_ref, advance onboarding_status
3b. Contact is new → proceed to registration with SOFT-MATCH guard (step 4)
4. SOFT MATCH at registration (decision #15): before creating a new identity, check for an
   existing user by mobile number and by (given_name, family_name). On a probable match,
   prompt "Is this you? Sign in instead" rather than silently creating a duplicate.
5. Worker may later ADD another email/phone in profile → verify → any pending membership
   targeting that contact links to the same identity (consolidation, with consent + audit).
6. ADMIN MERGE TOOL: a privileged action to merge two identities discovered to be the same
   person, re-pointing memberships, completions, and the QR proof to the surviving user_id
   (logged for audit).
```

Onboarding lifecycle (`entered → invited → logged_in → account_created`) is tracked per `company_membership`, so the same person can be at different stages for different companies. SMS magic-link is an authentication method alongside email/password, both resolving to the one `users` identity.

---

## 6. Notes, deferrals & open implementation questions

- **Service-role writes.** Completions, QR issuance, and notifications are written by trusted server/workflow code (Supabase service role), bypassing RLS by design; all user-initiated reads/writes go through the policies above. The pipeline (Inngest) runs as service role.
- **`roles` as enum arrays vs. join tables.** This design uses `enum[]` role columns for simplicity. If policy SQL gets unwieldy, switch to `*_membership_roles` join tables — interface to the app is unchanged.
- **Soft delete / retention.** Disabled statuses are used rather than hard deletes for auditability; a retention/right-to-deletion policy is a security-doc concern (PIPEDA), flagged in ExecutionPlan §5.3.
- **Photo on worker identity** is included but optional for MVP; it backs the QR visual-verification mitigation in the risk register.
- **Indexes.** Add covering indexes on every FK used in policies (`org_memberships(user_id, org_id)`, `company_memberships(user_id, company_id)`, `client_company_links(org_id, company_id)`, `orientation_completions(user_id, site_id) WHERE is_current`, `qr_proofs(token)`).
- **Done:** QR token scheme + verification security (HowDesign-QRVerification.md v2.0). **Next "How" docs:** notifications/eventing; media/video handling; environments, testing & the AI eval harness.

---

*End of HowDesign-DataModel.md*
