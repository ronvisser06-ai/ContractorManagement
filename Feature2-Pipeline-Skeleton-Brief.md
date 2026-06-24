# Feature 2 — Generation Pipeline Walking Skeleton (Plan-Mode Brief)

> **Milestone:** M0. **Goal of this feature:** the full orientation-generation skeleton end-to-end — job record, durable state machine, **real** deck extraction, realtime tracker, fixed renderer, approval gate, publish — with the **AI stages stubbed** (canned envelopes). It proves orchestration, storage, realtime, and the human gate *before any prompt engineering* (per orientation_pipeline_contracts_v0.1.md §6).
>
> **Discipline (non-negotiable):** this is one feature but built in the **steps below, one at a time — test in the browser and commit after each.** Not one mega-prompt. Start a fresh Claude Code conversation per step if context gets heavy (Rule 18).

---

## The three questions (locked)

1. **What:** A `generation_jobs` record + an Inngest durable workflow that walks a job through its states (`queued → extracting → structuring → generating_quiz → qa_review → awaiting_approval → publishing → published`), with **real extract** but **stubbed** structure/quiz/QA (canned envelopes), a Supabase-realtime stage tracker, the fixed block renderer, and the approval→publish gate producing an immutable versioned package.
2. **Who:** Internal engine, driven by a Content Developer / Client Admin. No *real* generated orientation yet — extract is real, but the content model + quiz are canned until M2.
3. **Done:** Upload a deck for a site → watch the job advance through every state live → land at `awaiting_approval` → approve → a published `OrientationPackage` exists, pinned to a `content_hash`; the renderer displays the (canned) content model; the `generation_jobs` RLS test passes.

## Scope decisions (this feature)

- **Real extraction now** (Python `python-pptx` / PDF), per orientation_pipeline_contracts_v0.1.md §4.1.
- **Structure / generate_quiz / qa_review stay stubbed** — they return canned envelopes that satisfy the contracts. Real AI is **M2**, not now.
- **Bounded approval editor is deferred to M2** (contracts §7). Feature 2's gate is view-the-draft → approve/publish only.
- **Open decision to settle in Step 3:** Python extractor hosting — Vercel Python function vs. a small separate service (ExecutionPlan.md §6, decision #5).

## Canonical references

`orientation_pipeline_contracts_v0.1.md` (job schema §2, stage envelopes §3, stage contracts §4, shared TS types §5, orchestration §6) · `HowDesign-DataModel.md` (`generation_jobs`, client-domain RLS) · `CLAUDE.md` §3/§5/§6.

## New tooling (expect setup friction, like Supabase/Vercel)

- **Inngest** — workflow engine: `inngest` package, the `/api/inngest` route, local dev server (`npx inngest-cli dev`), env keys. Stood up in Step 1.
- **Python runtime** — the extractor function + `requirements.txt` (`python-pptx`, a PDF lib). Stood up in Step 3.

---

## Working agreement (strict — do not deviate)

- The **whole skeleton is the destination**; we reach it **one step at a time, in order** — never all at once.
- **One step = one Claude Code prompt.** Steps are never bundled.
- A step is **not done** until *all* of: it works in the browser (Rule 7); TypeScript strict + lint + production build are clean; it's committed and pushed (Rule 9); BUILDLOG is updated (Rule 19).
- **The next step does not begin until the current step meets that bar.** Jacques runs a quick check between steps before greenlighting the next.
- Fresh Claude Code conversation when context gets heavy (Rule 18); BUILDLOG is the bridge.
- Splitting a step **smaller** is always allowed (Rule 10); merging steps **bigger** is not.

## Build order (one step → test → commit; Rules 6, 7, 9)

**Step 1 — Jobs table + shared types + Inngest stood up.**
Migration for `generation_jobs` (flat indexable columns + `jsonb` for artifacts/qa_history/telemetry/error, per contracts §2) with **org-scoped RLS + an RLS test**. Generate the **shared TS types** from contracts §5 into a shared module. Stand up Inngest with one hello function that runs locally. *Done:* a job row can be created (RLS-scoped); the Inngest dev server runs a test function.

**Step 2 — State machine + realtime tracker (all stages stubbed, incl. a placeholder extract).**
Inngest durable workflow implementing the state transitions (contracts §1); each stage a stub returning a canned envelope and writing an artifact ref to Supabase Storage. A "create job" trigger for a site. A **stage-tracker UI** subscribed to Supabase Realtime that shows the job advancing to `awaiting_approval`. *Done:* trigger a job → watch it walk the states live → it stops at `awaiting_approval`.

**Step 3 — Real Python extractor.**
A Python serverless function (`python-pptx` + PDF) producing `ExtractedDeck` conforming to contracts §4.1 (slides, text runs, tables, speaker notes, media `embed_state`, warnings). Decide hosting (Vercel Python fn vs. separate service). Wire it as the real `extracting` stage. *Done:* upload a real `.pptx` → an `ExtractedDeck` artifact is produced and stored; `linked_missing` media surfaces as a warning.

**Step 4 — Fixed renderer.**
Render a `ContentModel` through the **closed block-type set** (contracts §4.3) — `heading, paragraph, list, key_point, callout, hazard, image, video, table`. Unknown types rejected by schema validation. Renders the canned content model from the stubbed structure stage. Mobile-first. *Done:* the canned draft renders correctly on desktop and mobile; an unknown block type is rejected.

**Step 5 — Approval gate + publish.**
The `awaiting_approval` screen: view the draft (rendered content + the canned quiz with its `source_refs`), plus the `qa_flagged` issues if any. **Approve** → `publishing` → `published`, writing an immutable `OrientationPackage` (contracts §4.6) with `content_hash`, `version`, `requalification_policy`. (Bounded block editor deferred to M2.) *Done:* approve a draft → a versioned, hash-pinned `OrientationPackage` row exists; re-approving creates a new version.

## Definition of Done (whole feature)

End-to-end: create job → real extract → stubbed structure/quiz/QA → live tracker → `awaiting_approval` → approve → published package; renderer shows the content; `generation_jobs` RLS test green; TypeScript strict + lint + build clean; deployed to Vercel; BUILDLOG updated per step. Then `Jacques, ship check`.

## Carried-forward items (don't lose these)

- **Sentry** — still the parked micro-step; wire it before or early in this feature.
- **Email confirmation + Resend SMTP** — re-enable before pilot.
- *(Dropbox vs `web/.next` file-lock — exclude `web/.next` from Dropbox sync if EPERM recurs.)*
