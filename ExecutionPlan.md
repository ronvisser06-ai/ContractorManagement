# Contractor Orientation Management — Development Execution Plan

## Document Information

| Field | Value |
|-------|-------|
| **Document** | ExecutionPlan.md |
| **Version** | 1.1.0 |
| **Status** | Draft for review |
| **Last Updated** | 2026-06-23 |
| **Scope** | Orientation MVP only (mobile apps and Certs Check explicitly deferred) |
| **Execution model** | Solo developer + Claude Code |
| **Source documents** | DevelopmentPlan.md (2026-02-26), orientation_pipeline_contracts_v0.1.md (2026-06-22), CertsCheck.md (2026-02-26) |
| **Revision note** | v1.1.0 adds the rationalization deltas (§4a) and the AI-agent roadmap (§7a) from the design deep dive (DesignRationalization.md). Companion design docs: FunctionalOverview.md, HowDesign-DataModel.md, HowDesign-QRVerification.md. |

> This plan re-sequences and operationalizes DevelopmentPlan.md for a solo build driven by Claude Code. Where the source documents conflict, the resolution is stated explicitly in Section 1. The job/stage contracts in `orientation_pipeline_contracts_v0.1.md` are treated as the canonical data contract.

---

## 0. How to read this plan

The plan is organized as **milestones**, not calendar weeks, because a solo + agent pace is hard to fix to a calendar. Each milestone has a goal, an ordered task list, explicit acceptance criteria, and a "defer" note so scope creep is visible. Relative effort is sized **S / M / L / XL** (roughly: S = a day or two, M = under a week, L = one to two weeks, XL = multi-week). Dependencies are called out so you can see what must come before what.

The critical idea, taken from the contracts doc, is to build a **walking skeleton first**: the whole job pipeline end-to-end with the AI stages stubbed, before any real content generation. That proves orchestration, storage, the realtime tracker, and the human approval gate before you spend effort on prompts.

---

## 1. Key decision: reconcile the two "builder" visions

The two documents describe the orientation builder as two different products:

- **DevelopmentPlan.md, Phase 3** — a manual, three-panel **drag-and-drop authoring tool** (component menu, canvas, properties panel) with a component library, PowerPoint slide-to-image extraction, a filmstrip reorder view, inline question placement, undo/redo with 20 levels, auto-save, and a Test User preview. This is essentially building a mini-Articulate/Rise WYSIWYG editor.
- **orientation_pipeline_contracts_v0.1.md** — an **agent-orchestrated generation pipeline**: upload a PPTX/PDF, a deterministic extractor produces a normalized deck, an LLM builds a presentation-agnostic **content model** of typed blocks, an LLM builds a quiz that cites its source blocks, an evaluator agent QAs coverage/correctness/fidelity in a bounded rework loop, a Safety Professional approves at a human gate, and the result is frozen into an immutable versioned package. Rendering is **fixed code** over a closed set of block types — no model ever emits markup.

These are not two views of the same feature. They imply different data models, different effort profiles, and different UX.

### Recommendation: build the AI pipeline as the spine; make the "builder" a block-level editor on the approval gate

For a solo developer with Claude Code, I recommend committing to the **pipeline architecture** and treating the manual builder as a thin editing surface layered on top of it, for these reasons:

1. **The contracts doc is the newer, more rigorous artifact** (dated today, 2026-06-22, vs. the Feb plan) and is explicitly written to be the source of truth — "reference it from CLAUDE.md so Claude Code treats it as the spec." It already defines schemas, a state machine, and TypeScript types. That is most of the hard design work, done.
2. **A full WYSIWYG drag-and-drop editor is the single largest and riskiest piece of the Feb plan** (undo/redo, filmstrip reordering, properties panels, auto-save conflict handling). For a solo + agent build it is disproportionate effort for a feature your *content authors*, not your end users, touch. The pipeline gets you a publishable orientation from a PowerPoint in minutes with far less frontend surface area.
3. **The pipeline's fixed-renderer model is a gift to a solo build.** A closed set of nine block types renders identically on web today and mobile later. You build the renderer once. There is no open-ended canvas to maintain.
4. **Human control is preserved without the WYSIWYG cost.** The approval gate (`awaiting_approval`) is where a person reviews and corrects AI output. Give that screen a **block-level editor** — edit text, reorder/delete blocks, fix a quiz option, drop a block — operating directly on the content-model JSON. That satisfies the real need behind Phase 3 (a human must be able to fix the machine's output) without building a from-scratch authoring canvas.

**Net:** the content model and block contracts from v0.1 become the shared data model. The "builder" in this MVP = (a) the generation pipeline that drafts a package, plus (b) a constrained block editor on the approval screen. The full free-form drag-and-drop authoring tool, PowerPoint filmstrip UX, and 20-level undo are **deferred** — they can be added later against the same content model if a manual-authoring use case proves out.

> If you would rather keep manual authoring first-class for MVP, the alternative is to build the block editor as a standalone "create from blank" mode in addition to the pipeline. That is a meaningful add (call it +1 L milestone) and is not assumed below.

---

## 2. Locked technology stack (solo + Claude Code)

DevelopmentPlan.md offers either/or choices at most layers. For a solo build, every extra moving part is a tax. These are the recommended **locked** choices, biased toward a single integrated platform:

| Layer | Choice | Why this over the alternatives |
|-------|--------|-------------------------------|
| **Framework** | Next.js 14+ App Router + TypeScript | As specified. One framework for UI + API routes. |
| **Platform / DB / Auth / Storage / Realtime** | **Supabase** (Postgres + Auth + Storage + Realtime) | Collapses four services into one. Postgres RLS is the multi-tenant enforcement layer the plan already assumes. Realtime is exactly what the contracts doc calls for to drive the job stage tracker. Fewer accounts, fewer SDKs, less glue for a solo dev. |
| **ORM / migrations** | **Drizzle ORM** | SQL-first, type-safe, transparent migrations that pair well with Claude Code (it can reason about the generated SQL). Prisma is an acceptable substitute if you prefer its DX. |
| **Workflow engine** | **Inngest** | The contracts doc requires durable, resumable steps for the job state machine. Inngest is Vercel-native, has the best solo DX, and gives you step memoization, retries, and replay out of the box. (Trigger.dev or Temporal are heavier alternatives.) |
| **Deck extraction** | **Python serverless function** using `python-pptx` (and a PDF parser) | The contracts doc specifies `python-pptx`; there is no equivalent-fidelity JS library for speaker notes/tables. Keep it as one small isolated function; everything else stays TypeScript. This is the one polyglot seam — accept it deliberately. |
| **LLM** | **Anthropic API** — Sonnet for `structure` and `generate_quiz`, a stronger model for the `qa_review` evaluator | Matches the contracts doc's model-selection note. |
| **Email** | **Resend** | Clean DX, React email templates, good for invitations and QR delivery. |
| **QR generation** | `qrcode` npm package | As specified. |
| **Foreman scanning** | **PWA** with a camera/QR library (e.g. `html5-qrcode` or `@zxing/browser`) | No app store, installable, sufficient for MVP. Native is a deferred decision. |
| **Hosting** | **Vercel** | Next.js-native, edge, pairs with Inngest and Supabase. |
| **Error tracking / monitoring** | **Sentry** | As specified in Phase 7. Wire it in early, not at the end. |

**Decisions to lock before writing code** (see Section 6 for the full list): Drizzle vs Prisma; whether the Python extractor runs on Vercel's Python runtime or a separate container; and the QR security model (Section 5.3 of this plan).

---

## 3. Milestone plan

Mapping to the original phases is noted so you can trace this back to DevelopmentPlan.md. The biggest structural change: the walking skeleton (M0) comes first, and the old Phase 3 "builder" is folded into the pipeline (M2) rather than being a standalone WYSIWYG editor.

### M0 — Foundations & Walking Skeleton  · Size: L · (was Phase 1 + the skeleton note in contracts §6)

**Goal:** Stand up the project, auth, tenancy primitives, and the *entire* job pipeline end-to-end with the AI stages stubbed. Prove orchestration, storage, realtime, and the approval gate before any prompt work.

**Tasks (ordered):**
1. Repo, Next.js + TypeScript scaffold, Tailwind + shadcn/ui, lint/format, Vercel project, Sentry, environment config (dev/staging/prod).
2. Author `CLAUDE.md` and create `docs/contracts/` containing `orientation_pipeline_contracts_v0.1.md`; reference it as canonical from `CLAUDE.md` (see Section 7).
3. Supabase project; Drizzle setup; first migration for **core schema**: `organizations`, `sites`, `users`, `memberships` (user↔org↔role), `invitations`. Seed an org + admin.
4. Auth (Supabase Auth): email/password register, login, password rules, session handling.
5. **RLS policies** scoping all tenant data by `org_id`; **RBAC middleware** for the five roles (Client Admin, Content Developer, Foreman, Contractor Admin, Contractor User).
6. Client Admin can create an organization and add sites; basic app shell (nav, role-aware dashboard stubs).
7. **Job record + state machine** (contracts §1–§2) implemented as Inngest durable steps; object storage wired (Supabase Storage) with `storage_key` + `sha256` per artifact.
8. **Extract step is real** (can be a minimal version); `structure`, `generate_quiz`, `qa_review` **stubbed** to return canned envelopes that satisfy the contracts.
9. **Fixed renderer** for the closed block-type set (contracts §4.3) — render a canned content model.
10. **Job stage tracker UI** subscribed to Supabase Realtime; **approval gate** screen reachable at `awaiting_approval`.
11. Deploy the whole skeleton to staging and walk a job from `queued` → `published` with stubs.

**Acceptance criteria:**
- A user can register, log in, and see role-appropriate views; Client Admin can create an org + sites.
- Tenant isolation verified — no cross-tenant data leakage (write an explicit RLS test).
- A job can be created and driven through every state to `published` using stubbed AI stages, with the stage tracker updating live and a human able to click "approve" at the gate.
- Artifacts are stored by key + hash, never inlined.

**Defer:** real AI prompts, contractor flows, QR, foreman.

---

### M1 — Tenancy, Sites & Contractor CRM  · Size: L · (was Phase 2)

**Goal:** Clients invite contractor companies; contractor admins build profiles and register workers; lifecycle status is tracked.

**Tasks:**
1. Schema: `contractor_companies`, `contractor_users`, `contractor_user_status`, plus the **many-to-many `client_relationships`** (a contractor company ↔ multiple client orgs).
2. Client Admin: invite contractor company (email invite via Resend, tokenized link).
3. Contractor Admin: accept invite, create company profile (trade/work types, contact info, logo upload to Supabase Storage).
4. Contractor Admin: add employees (first/last name, email, mobile); invite workers; Contractor User registration flow.
5. Lifecycle status engine: `Entered → Invited → Logged In → Account Created`, visible to both Contractor Admin and Client Admin.
6. CRM dashboards: Contractor Admin employee list with status; Client Admin view of companies and their workers.

**Acceptance criteria:**
- Full invite → registration works for both companies and individual contractors.
- Status progression is tracked and visible to the right roles.
- A contractor company can hold relationships with more than one client org without data bleed.

**Dependencies:** M0. **Defer:** bulk CSV import (listed as future), SSO.

---

### M2 — Orientation Generation Pipeline (real AI) + Approval Editor  · Size: XL · (replaces Phase 3; aligns to contracts §4)

**Goal:** Turn a PowerPoint/PDF upload into a reviewed, approved, immutable orientation package. This is the heart of the product and absorbs the old "builder."

**Tasks:**
1. **Extract** (Python serverless, `python-pptx` + PDF): produce `ExtractedDeck` (contracts §4.1) — slides, text runs, tables, images, **speaker notes**, media assets with `embed_state`, warnings (e.g. `MEDIA_LINK_UNRESOLVED`).
2. **Structure** (Claude Sonnet): `ExtractedDeck → ContentModel` (contracts §4.2) — typed blocks, modules, learning objectives, `source_ref` on every block, `hazard_index`.
3. **Generate quiz** (Claude Sonnet): `ContentModel → Quiz` (contracts §4.4) — questions citing `source_refs`, `coverage_map`, pass threshold, attempts, shuffle config.
4. **QA evaluate** (stronger model, isolated subagent): produce `QAVerdict` (contracts §4.5) — coverage/correctness/fidelity scores, issues with severity + `target_stage`, `routed_to`, `decision`. Wire the **bounded rework loop** (`rework_count < max_rework`), including the deliberate "escalate to human at `awaiting_approval` with `qa_flagged=true`" path.
5. **Approval gate UI:** side-by-side review (each question next to the `source_refs` blocks it cites; open `qa_flagged` issues shown) **plus the block-level editor** — edit block text, reorder/delete blocks, fix quiz options/answers, set `requalification_policy`. This is the reconciled "builder."
6. **Publish** (contracts §4.6): freeze content model + quiz into `OrientationPackage` with `content_hash`, version, `supersedes`, asset manifest. Completion records will pin to `content_hash`.
7. Caching/idempotency by `(job_id, stage, attempt, input_sha256)`; telemetry (timings, token usage, cost) on the job record.
8. Site assignment: assign a published package to one or more sites; new versions on edit with old versions retained.

**Acceptance criteria:**
- Uploading a representative PPTX produces a content model + quiz that pass QA or escalate cleanly to the human gate.
- A reviewer can correct AI output at the gate and approve; publish produces an immutable, versioned, hash-pinned package.
- A rework loop runs and terminates within `max_rework`; exhaustion routes to human review, never a dead-end failure.
- Linked-but-missing media (the `confined_space.mp4` case) surfaces as a warning the reviewer must resolve, not a silent drop.

**Dependencies:** M0 (skeleton, renderer, gate). **Defer:** AI quiz-from-text as a separate feature (it's now intrinsic), Rev 2 question types, multi-language.

---

### M3 — Contractor Orientation Experience & QR Issuance  · Size: L · (was Phase 4 contractor-facing half)

**Goal:** A contractor completes an assigned orientation, passes the quiz, and receives a QR code.

**Tasks:**
1. Renderer-driven, page-by-page orientation **player** (reuses the M0 fixed renderer) with forward/back navigation; video playback (optional required-viewing flag); in-browser PDF viewing.
2. Inline questions with immediate feedback + end-of-module quiz with randomization; combined scoring; running "Correct X / Answered Y".
3. Pass/fail determination, results screen, retry logic within configured attempt limits.
4. **Completion records** pinned to the package `content_hash` and version.
5. **QR generation** (`qrcode`) on pass; **email delivery** (Resend).
6. **Public status page** the QR resolves to, with the security model from Section 5.3.

**Acceptance criteria:**
- A contractor completes content → inline questions → end quiz → receives a QR by email.
- Failed contractors can retake within limits; completion record ties to the exact version/hash they were tested against.
- The QR resolves to a status page that cannot be enumerated or forged (see 5.3).

**Dependencies:** M2. **Defer:** video completion enforcement (anti-skip), digital wallet.

---

### M4 — QR Verification & Foreman Experience (PWA)  · Size: M · (was Phase 5)

**Goal:** Foremen scan QR codes on-site and instantly see contractor status.

**Tasks:**
1. Foreman **PWA** with camera QR scanning.
2. Scan result: name, company, orientation status, completion + expiry dates, score; status indicators Active / Expired / Revoked / Not Found.
3. **Scan audit log** (`qr_scans`): who, when, where, result.
4. Client Admin **revoke** access (flips scan result to Revoked); **expiration logic** from a client-configured duration; expired/revoked messaging on scan.
5. Foreman dashboard: contractors expected on site, filter by status.

**Acceptance criteria:**
- Scan-to-status under 2 seconds; expired and revoked states display correctly; every scan logged with foreman identity and timestamp.

**Dependencies:** M3 (QR + status page). **Defer:** offline scanning (needs the deferred native app), geofencing.

---

### M5 — Dashboards, Reporting, Hardening & Pilot  · Size: L · (was Phase 6 + Phase 7)

**Goal:** Management visibility, scheduled notifications, and production readiness for a pilot client.

**Tasks:**
1. Client Admin dashboard: completion rates by site and by contractor company. Contractor Admin dashboard: worker orientation status. Content analytics: question-level pass/fail, score distribution, completion time, drop-off.
2. Compliance views: approaching-expiration and overdue.
3. Scheduled **email notifications**: expiry warnings at 30/14/7 days; completion confirmations. (Use a scheduled Inngest function.)
4. Export: CSV and PDF reports.
5. Hardening: OWASP Top 10 pass, RLS audit, rate limiting/abuse prevention, performance (lazy loading, caching), load test, Sentry alerts, **automated DB backups + tested restore**.
6. Responsive polish (desktop/tablet/mobile web), error/edge-case handling, admin + user docs.
7. **Pilot onboarding** with one client; feedback loop.

**Acceptance criteria:**
- Dashboards load within 3s; expiry notifications fire on schedule; reports export as CSV and PDF; backup/restore verified; pilot client onboarded.

**Dependencies:** M1–M4. **Defer:** everything in Section 7 of DevelopmentPlan.md not explicitly above.

---

## 4. Milestone summary & critical path

| Milestone | Maps to | Size | Depends on |
|-----------|---------|------|-----------|
| M0 Foundations & Walking Skeleton | Phase 1 + contracts §6 | L | — |
| M1 Tenancy, Sites & Contractor CRM | Phase 2 | L | M0 |
| M2 Generation Pipeline + Approval Editor | Phase 3 (reconciled) + contracts §4 | XL | M0 |
| M3 Contractor Experience & QR Issuance | Phase 4 | L | M2 |
| M4 QR Verification & Foreman PWA | Phase 5 | M | M3 |
| M5 Dashboards, Reporting, Hardening, Pilot | Phase 6 + 7 | L | M1–M4 |

**Critical path:** M0 → M2 → M3 → M4 → M5. M1 (contractor CRM) can be built in parallel with M2 once M0 lands, since the pipeline doesn't depend on contractor flows until assignment/completion. For a solo dev, "parallel" means *interleavable* — do M1 while waiting on prompt iteration in M2.

---

## 4a. Rationalization deltas (v1.1)

The design deep dive (DesignRationalization.md) changed several behaviors. Each delta is folded into the milestone noted; the design docs are authoritative for detail.

| Delta | Milestone | Note |
|-------|-----------|------|
| **SMS magic-link** invite + sign-in (not just email) | M1 | mobile captured per worker; auth method alongside email/password |
| **Identity soft-match + admin merge** (mobile/name) | M1 | prevents duplicate identities defeating "one identity" |
| **Two-layer site model**: company eligibility + per-worker **activation** (`site_worker_activations`) | M1 | foreman list & compliance denominator use activated crew |
| **Bounded approval editor** (scope pinned in pipeline contracts §7) | M2 | guards against WYSIWYG scope creep |
| **Worker-centric single QR** (one code, resolved to foreman's active site) | M3 issuance, M4 scan | supersedes per-site QR; removes "wrong QR" failure |
| **Assisted / "kiosk" completion** + SMS sign-in for no-email/no-device workers | M3 | biggest lever on the >90% completion metric |
| **Video integrity**: skip hidden until complete; skip warns + restarts | M3 | required-viewing now enforced (was deferred) |
| **Lockout** on max attempts + foreman/Client-Admin reset (single/bulk) | M3 build, M4 foreman reset, M5 bulk reset | new `orientation_lockouts` table + notifications |
| **Foreman active-site context** | M4 | drives worker-centric resolution |
| **Scan status `INCOMPLETE`** distinct from `NOT_FOUND` | M4 | clearer gate UX |
| **Requalification + lockout notifications** | M5 | worker notice + company summary; lockout alerts |

---

## 5. Gaps & under-specified areas (what is missing)

This is the "what's missing" review. Items are grouped by priority. **Critical** items should be resolved before or during M0; **Important** before the milestone that needs them; **Nice-to-have** can wait.

> **Status update (v1.1):** several critical/important gaps below are now **resolved** by the design docs — the field-level data model + RLS and cross-tenant identity (HowDesign-DataModel.md), the QR security model (HowDesign-QRVerification.md), and the MVP notification catalog + no-email path (FunctionalOverview.md §5, and DesignRationalization.md). Still open: NFR/scale targets, media/video handling specifics, the testing + AI eval harness, and the MVP security/privacy baseline (PIPEDA, data residency).

### 5.1 Missing documents (referenced but not in the folder)

CertsCheck.md's header references two documents that are not present:
- **`WorkflowandRequirements.md`** — presumably the functional requirements / user-flow source. Its absence means there is no single requirements spec; requirements are scattered across the three docs.
- **`OrientationContentBuilder.md`** — presumably the detailed builder spec behind Phase 3. Its absence is part of why the builder vision is ambiguous (Section 1).

Recommend locating these or formally declaring them out of scope so the doc set is self-consistent.

### 5.2 Critical gaps (resolve at/before M0)

1. **Architectural reconciliation of the two builder visions.** Addressed in Section 1, but it needs your sign-off — it is the single biggest open decision and it changes the data model and M2 scope.
2. **Field-level data model + RLS policies.** DevelopmentPlan.md §5 is only an entity sketch; the contracts doc fully specifies the *job/package* shapes but **not** the core platform tables (`organizations`, `sites`, `contractor_users`, `qr_codes`, `qr_scans`, `orientation_completions`, `invitations`, `memberships`). There is no DDL, no field types, no indexes, and **no written RLS policy definitions** — yet RLS is the entire multi-tenant security story. This must be designed before M0 step 3.
3. **Cross-tenant contractor identity model.** The docs assert a contractor can work for multiple clients and that QR codes are "separate per client relationship," but never define how a single contractor identity maps to multiple org relationships, how invitations reconcile to an existing identity, or how consent governs cross-tenant visibility. This shapes auth and the schema.
4. **QR code security model.** "Static QR linking to a status page" is specified, but not: what the QR encodes, whether the status URL uses an unguessable signed token, how enumeration/scraping of contractor PII is prevented, how a public/foreman-facing page authorizes the viewer, and what happens on revoke. Needed before M3/M4. (Recommendation: opaque signed token per contractor×site×client, server-validated, no PII in the URL, page gated to authenticated foremen or short-lived signed links.)

### 5.3 Important gaps (resolve before the relevant milestone)

5. **Auth specifics:** session strategy, invitation token lifetime/single-use, password reset, email verification, and how the five roles attach to a user across orgs.
6. **Orientation expiration & requalification policy (operational).** The contracts doc has `requalification_policy` (`full | new_content_only | none`); DevelopmentPlan is vague on who sets the expiry **duration**, where it lives (site? package? client default?), and how requalification is triggered when a new version publishes. Needed for M3/M4/M5.
7. **Notification/event catalog for the orientation MVP.** CertsCheck.md has a rich notification matrix; the orientation MVP does not. Define the event list (invited, registered, completed, QR issued, expiring 30/14/7, expired, revoked), channels, and templates before M5.
8. **Media/video handling.** No spec for max file sizes, supported formats, video hosting/transcoding/streaming, storage quotas per tenant, or CDN. The extractor's `linked_missing` media case (external video not embedded) needs a defined remediation flow. Needed for M2/M3.
9. **Testing & CI/CD strategy.** No test plan, no environments definition, no CI pipeline, no Definition of Done. For an AI pipeline specifically, you need a **golden-set/eval harness** for the `structure`, `generate_quiz`, and `qa_review` stages (sample decks → expected content model/quiz/verdict) so prompt changes don't regress. Define a baseline DoD at M0 and the eval harness at the start of M2.
10. **AI pipeline operations:** prompt/version management, cost ceilings and alerting per job, model fallback/timeouts, and **PII/data-handling for uploaded decks** (decks may contain names, site details). Tie to M2.
11. **Security & privacy for the MVP.** DevelopmentPlan's security lives only in Phase 7; CertsCheck has a security section but orientation does not. Given the Canadian industrial market (provincial OHS references), address **PIPEDA**, data residency (Canadian region), audit-logging scope, data retention, and a privacy policy. Pull a lightweight security baseline forward into M0 rather than leaving it all to M5.
12. **Non-functional requirements / scale targets.** No stated numbers for expected contractors, sites, concurrent users, or content volume; only a few success metrics. Accessibility (WCAG level?), supported browsers, and i18n-readiness are unspecified. These drive M5 sizing and some M0 architecture choices.

### 5.4 Nice-to-have gaps

13. **Product analytics** (beyond the job telemetry already in the contract) — funnel/adoption instrumentation.
14. **Seed/demo data & new-client onboarding wizard** — how a brand-new tenant gets a working first orientation.
15. **Design/UX artifacts** — no wireframes or documented user flows; shadcn is chosen but no design system decisions.
16. **Legal** — terms of service, contractor data consent, content ownership/IP.
17. **Cost/budget model** — projected infra + Anthropic API spend at pilot and at scale.
18. **Canonical doc hierarchy & versioning.** The plan dates disagree (Feb vs June). Declare which document wins on conflict (recommendation: this ExecutionPlan for sequencing, the contracts doc for data shapes) and keep a changelog.

---

## 6. Decisions to lock before writing code

| # | Decision | Recommendation | Blocks |
|---|----------|----------------|--------|
| 1 | Builder approach (Section 1) | AI pipeline as spine + block editor at approval gate; defer WYSIWYG | M2 scope |
| 2 | Supabase vs Firebase/Clerk/Neon split | Supabase (single platform) | M0 |
| 3 | Drizzle vs Prisma | Drizzle | M0 |
| 4 | Workflow engine | Inngest | M0 |
| 5 | Python extractor hosting | Vercel Python function vs separate container — decide based on `python-pptx` cold-start/size | M2 |
| 6 | QR security model | Opaque signed token; no PII in URL; server-validated | M3 |
| 7 | Data residency / region | Canadian region for Supabase + AI processing (PIPEDA) | M0 |
| 8 | Expiry duration ownership | Site-level default with package override (proposed) | M3 |

---

## 7. Setting up Claude Code for this build

A few practices make a solo + Claude Code build go smoothly:

- **`CLAUDE.md` at repo root** pointing to `docs/contracts/orientation_pipeline_contracts_v0.1.md` as the canonical data contract, plus this ExecutionPlan as the milestone source of truth. State the locked stack (Section 2) so the agent stops re-litigating choices.
- **Generate the shared TypeScript types** from contracts §5 into a shared package both the web app and (future) mobile import. Make the Python extractor emit JSON that conforms to the same `ExtractedDeck` shape.
- **Build the skeleton with stubs first** (M0) exactly as contracts §6 advises — canned envelopes that satisfy the schemas — so orchestration, storage, realtime, and the approval gate are proven before prompt engineering.
- **One milestone = one working branch**, with the milestone's acceptance criteria pasted into the PR description as the Definition of Done. Have Claude Code write the RLS test and the pipeline eval harness early; they are your regression safety net.
- **Keep the block-type set closed.** Adding a block type means updating the renderer and the schema validator deliberately — never let a model invent markup.

---

## 7a. AI-agent roadmap (beyond the generation pipeline)

The MVP already contains one agent loop (generation + QA). The deep dive surfaced further agent opportunities; their disposition is recorded here.

**In the development pipeline (post-MVP enhancements, build after core ships):**

- **Adaptive remediation agent** — on a failed quiz, re-explain the *specific* missed concept and re-test just that area instead of a blunt full retry. Lifts pass rates and reduces lockouts. *(Decision #12.)*
- **Client setup assistant** — conversational site profiling: the admin describes the site's work and hazards in plain language; the agent proposes the orientation outline (and, later, cert requirements). Targets the "<1 week onboarding" metric. *(Decision #13.)*

**Parking lot (valuable; revisit once development is underway):**

- **Orientation help agent** — in-experience copilot grounded in the content model ("what does H2S mean?"); high completion-rate impact, reuses structured content.
- **Regulatory-change monitor** — watches BC/AB/SK OHS changes and flags stale orientations/cert requirements; a defensible compliance moat.
- **Fraud / anomaly-detection agent** — patterns in scans/completions (one code resolving at two distant sites, implausibly fast completions, duplicate identities); the planned compensating control for the no-photo QR residual.

**Noted, not scheduled:** broader ingestion agent (manuals/PDFs/SharePoint → modules), localization agent (translate content model + quiz, flag safety-critical terms), analytics-narrative agent (plain-English dashboard insights). The **certificate-extraction agent** remains the marquee CertsCheck future item.

> Sequencing intent (Ron): get core development underway, then explore the orientation help agent and the regulatory-change monitor first among the parked items.

---

## 8. Out of scope for this plan (deferred)

Explicitly **not** in this MVP execution plan, per the agreed scope:

- **Mobile applications** (contractor capture app, foreman native app) — PWA only for foreman scanning here.
- **Certs Check module** in full (certificate capture, AI extraction, compliance engine, combined QR, daily deficiency reports). *Design hooks to keep in mind now so it slots in later:* keep the content model and QR status page extensible, and keep the QR token scheme able to carry a combined orientation + certification status later.
- Rev 2 question types, AI quiz generation as a separate feature, jurisdiction-/trade-driven requirements, issuing-body API integration, SSO/SAML, bulk CSV import, SCORM/xAPI, badge printing, offline scanning, digital wallet, geofencing.

These remain in DevelopmentPlan.md §7 and CertsCheck.md as the post-MVP roadmap.

---

*End of ExecutionPlan.md*
