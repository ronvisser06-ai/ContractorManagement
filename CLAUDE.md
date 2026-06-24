# Contractor Orientation Management — Project Guide (with Jacques)

This is the root config for building the **Contractor Orientation Management** platform. Development is coached by **Jacques**, the disciplined vibe-coding system (the 20 Vibe Coding Rules). See `JACQUES.md` and `JACQUES_QUICK_START.md` for how to invoke and work with Jacques.

**Core philosophy (Jacques):** Think clearly before you prompt. Plan before you build. **One feature at a time.** Test after every change. Commit when it works. Ship before perfect.

> Think → Plan → Build (one feature) → Test → Commit → Polish → Ship → Repeat.

---

## 1. What we're building

A multi-tenant web platform that ensures every contractor arriving at an industrial site has completed that site's required safety orientation, and lets a foreman verify it in seconds by scanning a single QR code. Orientations are generated from an uploaded deck by an AI pipeline, reviewed and approved by a human, then published as immutable versioned packages. Workers complete them online (or via assisted/kiosk + SMS), pass a quiz, and carry one QR proof resolved live at the gate.

Full functional definition: **FunctionalOverview.md**. Nothing is built that isn't grounded in the design docs below.

---

## 2. Canonical documents (read before building)

| Doc | Role |
|-----|------|
| **FunctionalOverview.md** | The "What" — capabilities, roles, behaviors. Source of truth for product behavior. |
| **ExecutionPlan.md** | The "How" — milestones M0–M5, locked stack, sequencing, gaps, AI-agent roadmap. |
| **orientation_pipeline_contracts_v0.1.md** | Canonical data contracts for the generation pipeline (job/stage/package shapes) + §7 approval-editor scope. |
| **HowDesign-DataModel.md** | Field-level schema, three-domain tenancy, RLS/access model, identity. |
| **HowDesign-QRVerification.md** | Worker-centric single-QR security & verification flow. |
| **DesignRationalization.md** | Why key decisions are what they are (deep-dive log). |
| **DevelopmentPlan.md** | Original plan (superseded on conflicts by ExecutionPlan + the How docs). |
| **BUILDLOG.md** | Session log — update after every feature (Rule 19). |

On any conflict: behavior → FunctionalOverview; data shapes → the contracts/How docs; sequencing → ExecutionPlan.

---

## 3. Locked technology stack (do not re-litigate — Rule 5)

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14+ (App Router) + TypeScript (strict, no `any`) |
| UI | Tailwind CSS + shadcn/ui; **mobile-first** |
| Platform / DB / Auth / Storage / Realtime | **Supabase** (Postgres + Auth + Storage + Realtime) |
| ORM / migrations | **Drizzle** |
| Workflow engine | **Inngest** (durable steps for the generation job) |
| Deck extraction | small **Python** serverless fn (`python-pptx` / PDF) — the one polyglot seam |
| LLM | **Anthropic API** — Sonnet for structure/quiz, stronger model for QA evaluator |
| Email / SMS | **Resend** (email); SMS provider for magic-link invite/sign-in |
| QR | `qrcode` (generation), `html5-qrcode`/`@zxing/browser` (foreman PWA scanning) |
| Hosting / monitoring | **Vercel** + **Sentry** |

---

## 4. Development sequence (milestones → one feature at a time)

**Repo layout:** the Next.js app lives in **`/web`**; design docs, `CLAUDE.md`, and the Jacques files stay at the repo root. Run all `npm` commands from inside `web/`.

Build in this order (ExecutionPlan §3). A milestone is **not** a feature — inside each, pick ONE feature, plan it, build it, test it, commit it, then take the next (Rule 6).

- **M0 — Foundations & Walking Skeleton** (start here): scaffold, Supabase + Drizzle + Inngest, core schema + RLS, auth + RBAC (6 roles), org/site CRUD, the job state machine end-to-end with AI stages **stubbed**, fixed renderer, realtime stage tracker, approval gate. Deploy to staging.
- **M1 — Tenancy, Sites & Contractor CRM**: company invite (email/SMS) → registration with soft-match, profiles, workers, lifecycle, crew **activation**, cross-tenant identity.
- **M2 — Generation Pipeline + bounded Approval Editor**: real extract/structure/quiz/QA loop; side-by-side approval + bounded block editor (contracts §7); publish immutable versioned package.
- **M3 — Contractor Experience & QR Issuance**: page-by-page player (video-skip warns+restarts), inline+end quiz, scoring/retries/lockout, completion pinned to content_hash, single per-worker QR issued + delivered, assisted/kiosk completion.
- **M4 — QR Verification & Foreman PWA**: foreman active-site context, worker-centric scan, status (active/expired/revoked/incomplete/not_found), scan log, lockout reset.
- **M5 — Dashboards, Reporting, Hardening & Pilot**: dashboards, requalification + expiry + lockout notifications, exports, OWASP/RLS audit, backups, pilot.

**Walking-skeleton-first (M0):** implement the job record, state machine, deterministic extract, and the fixed renderer first, with structure/quiz/QA stubbed to return canned envelopes — prove orchestration, storage, realtime, and the approval gate before any prompt engineering.

---

## 5. Code standards

- **TypeScript strict.** No `any` — use `unknown` and narrow. Interfaces for objects. Explicit error types.
- **Functional React components**; logic in custom hooks. Props typed (no PropTypes).
- **Mobile-first** responsive (Rule 14). Typography & spacing before color (Rule 15). Polish last (Rule 16).
- **RLS-first:** every tenant table ships with its row-level-security policy in the same change. Never rely on app-layer checks alone.
- **Closed block-type set:** renderers consume only the block types in the contract. Never have a model emit HTML/markup; adding a block type means updating renderer + schema validator deliberately.
- **Generate shared types** from the contracts (`orientation_pipeline_contracts_v0.1.md §5`) into a shared package; the Python extractor emits conforming JSON.
- Structured errors `{ error, code, context? }`; log with context; user-facing messages clear and actionable.

---

## 6. Constraints — what NOT to do (Rule 12)

- **Do not** build out of MVP scope: no mobile native apps, no Certs Check, no trade/jurisdiction cert logic, no multi-language, no SSO, no offline scanning. (FunctionalOverview §9.)
- **Do not** rebuild the deferred WYSIWYG builder — the only authoring surface is the **bounded** approval editor (contracts §7).
- **Do not** overengineer or add abstractions for one-time things. Ship first, refactor later.
- **Do not** add dependencies without checking; the stack is locked (§3).
- **Do not** make architectural changes without flagging them.
- **Do not** put PII in QR/status URLs; verification is authenticated + worker-centric (HowDesign-QRVerification).
- **Do not** weaken tenant isolation; cross-tenant reads go only through the bridge tables.

---

## 7. Testing & shipping discipline

- **Test after every change** in the browser (Rule 7). Build an **RLS test** (no cross-tenant leakage) and a **pipeline eval harness** (sample deck → expected content model/quiz/verdict) early — they are the regression net.
- **Commit to git after every working feature** (Rule 9), clear message. Run lint + tests before commit.
- **One conversation per feature** (Rule 18); `/compact` when long (Rule 11).
- **Update BUILDLOG.md** after each feature (Rule 19): what I built, what broke + fix, what's next.
- **Ship before perfect** (Rule 20): when the feature works and looks decent, ship and get feedback.

---

## 8. Working with Jacques

Invoke explicitly when you want coaching:

- `Jacques, start feature` — plan the next single feature (3 questions, scope, success criteria).
- `Jacques, check progress` — audit against the rules.
- `Jacques, I'm stuck` — change angle / break it down (Rule 10).
- `Jacques, how's the design` — mobile/typography/spacing review.
- `Jacques, ship check` — validate before going live.
- `Jacques, what's next` — pick the next feature.

Jacques also passively flags violations of Rules 1, 2, 6, 20 — when flagged, correct course. The 20 rules are summarized in `JACQUES_QUICK_START.md`.

---

**Last Updated:** 2026-06-23 · Design phase complete; **M0 is the next build.**
