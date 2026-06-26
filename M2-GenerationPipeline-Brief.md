# M2 — Generation Pipeline (Real AI) + Bounded Approval Editor (Plan-Mode Brief)

> **Milestone goal:** replace the three stubbed AI stages in the M0 walking skeleton with **real Anthropic calls** producing contract-conforming `ContentModel` / `Quiz` / `QAVerdict`; run the **bounded QA rework loop**; add the **bounded block editor** at the approval gate (contracts §7); and stand up an **eval/golden-set harness** so prompt changes can't silently regress. Finally, wire the pipeline into production.
>
> **Scope decisions (locked):** **local-first** — build + eval all AI stages and the editor locally; wire Inngest Cloud + the Python extractor into **production as the final step**. Eval harness **anchored on the real Proton Safety Orientation deck** (in `SampleOrientation/`) plus 1–2 small synthetic edge-case decks.

---

## Working agreement (strict — do not deviate)

- The whole milestone is the destination; reach it **one step at a time, in order**.
- **One step = one Claude Code prompt.** Steps are never bundled.
- A step is **not done** until: it works (Rule 7); TypeScript strict + lint + build clean; the **eval harness** covers it where applicable; committed and pushed (Rule 9); BUILDLOG updated (Rule 19).
- **The next step does not begin until the current step meets that bar.** Jacques checks between steps.
- Fresh Claude Code conversation when context gets heavy (Rule 18); BUILDLOG is the bridge.
- Splitting a step **smaller** is always allowed (Rule 10); merging steps **bigger** is not.
- **Closed block-type set is law** (CLAUDE.md §5): no model ever emits HTML/markup; adding a block type means updating renderer + validator deliberately.

---

## The three questions (locked)

1. **What:** real `structure`, `generate_quiz`, `qa_review` stages (Anthropic) producing contract-conforming artifacts; the bounded rework loop; the bounded approval editor; and an eval harness as the regression net.
2. **Who:** Content Developers (generate) and Content Approvers (review/edit/approve). Output feeds the contractor experience (M3).
3. **Done:** upload a real deck → AI structures it + builds a quiz citing source blocks → QA scores it (rework bounded, escalates to human on exhaustion) → reviewer corrects in the bounded editor and approves → immutable published package; eval harness guards quality; pipeline runs in production.

## Canonical references

`orientation_pipeline_contracts_v0.1.md` §3 (stage envelope), §4.2 (`ContentModel`), §4.3 (closed block set), §4.4 (`Quiz`/`source_refs`/`coverage_map`), §4.5 (`QAVerdict`/routing), §6 (orchestration, model selection), **§7 (bounded approval-editor scope)** · `ExecutionPlan.md` §2 (LLM: Sonnet for structure/quiz, stronger/Opus-class for QA), §6 #5 (extractor hosting) · `CLAUDE.md` §5 (closed block set), §7 (eval harness) · `HowDesign-DataModel.md` (`orientation_packages`).

## Non-determinism note (how to test LLM stages)

Assert **structural + coverage properties**, never exact text: schema-valid output, every block has a `source_ref`, every objective/critical-hazard is testable, citations resolve, the rework loop terminates. Golden fixtures (from the Proton deck) anchor regressions. Seed synthetic decks with deliberate defects to prove QA catches them.

---

## Build order (one step → test → commit; Rules 6, 7, 9)

**Step 1 — Anthropic wiring + eval harness scaffold + real `structure` stage.**
Set up the Anthropic SDK + `ANTHROPIC_API_KEY` (local env). Replace the `structure` stub in the Inngest workflow with a real **Sonnet** call: `ExtractedDeck → ContentModel` per §4.2 — typed blocks (closed set only), `source_ref` on every block, learning objectives, `hazard_index`. Run the schema validator on the output; repair/reject non-conforming. **Stand up the eval harness** anchored on the Proton deck (+ 1–2 synthetic decks): asserts schema-valid, every block has a `source_ref`, hazards captured, sane length/reading-level; save golden fixtures. *Done:* real structure stage produces a conforming model from the Proton deck; eval green. (Downstream still stubbed; runs locally.)

**Step 2 — Real `generate_quiz` stage.**
Replace the quiz stub with a real **Sonnet** call: `ContentModel → Quiz` per §4.4 — each question cites `source_refs`, plus `coverage_map`, `pass_threshold`, `attempts_allowed`, shuffle flags. Validate. Extend the eval: every learning objective and every critical hazard (via `hazard_index`) is exercised by ≥1 question; options well-formed; `correct_option_ids` valid; rationale cites blocks. *Done:* real quiz from the Proton content model, citing sources; eval green.

**Step 3 — Real `qa_review` evaluator + bounded rework loop.**
Replace the QA stub with the real evaluator (**stronger/Opus-class** model) as an isolated subagent per §4.5: `QAVerdict` with coverage/correctness/fidelity scores, issues (severity + `target_stage` + `target_ref`), `routed_to`, `decision`. Wire the bounded loop (`rework_count < max_rework`): route `needs_rework` to `structure` or `generate_quiz`; on exhaustion, advance to `awaiting_approval` with `qa_flagged=true` + open issues (never fail). Eval: golden verdicts on the Proton deck, plus a synthetic deck with a **seeded wrong answer** that QA must flag; prove the loop terminates within budget. *Done:* real QA loop flags real issues, terminates, escalates correctly; eval green.

**Step 4 — Bounded approval editor (contracts §7).**
At `awaiting_approval`, a block-level editor operating on the `ContentModel`/`Quiz` JSON. **Allowed:** edit block text; reorder/delete blocks + modules; insert a block from the closed set; edit a question (stem/options/correct answer/rationale); add/remove questions; toggle shuffle; set `pass_threshold`/`attempts_allowed`; set `requalification_policy`; resolve `qa_flagged` issues; resolve media warnings. **Excluded:** free-form layout, new block types, fonts/colors/theming, raw HTML/markdown, per-learner branching, drag-drop slide authoring. Edits preserve each block's `id`/`source_ref`, produce a `produced_by.kind="human"` envelope, and re-run schema validation before `publishing`. *Done:* a reviewer corrects AI output within scope and approves → publishes (reusing the M0 publish path); out-of-scope edits are impossible; validation blocks bad state.

**Step 5 — Production pipeline wiring + end-to-end prod verification.**
Stand up **Inngest Cloud** (signing/event keys; register `/api/inngest`; keys in Vercel). Deploy **`python-extractor`** as its own Vercel project (`runtime.txt`, its 3 env vars, wire `EXTRACTOR_URL`/`EXTRACTOR_SHARED_SECRET` into web). Add `ANTHROPIC_API_KEY` to Vercel. Decide the **extractor timeout host** for large decks (Vercel Pro `maxDuration` vs. an alternative host — real decks took ~73s; Hobby caps at 10s). Verify: upload a real deck **in production** → the full pipeline runs end-to-end (extract → structure → quiz → QA → approve → publish). *Done:* a real generation completes in production.

---

## Definition of Done (whole milestone)

A real deck flows end-to-end through real AI: structured + quizzed (citing sources) → QA-evaluated with a bounded rework loop → reviewer-corrected in the bounded editor → immutable published package — locally **and** in production. Eval harness green (incl. seeded-defect detection); TypeScript strict + lint + build clean; BUILDLOG updated per step. Then `Jacques, ship check`.

## Provider setup (expect friction, like Resend/Sentry)

- **Anthropic API key** — `ANTHROPIC_API_KEY` (Step 1 local; Step 5 Vercel).
- **Inngest Cloud** + **Python extractor prod deploy** — Step 5.

## Carried-forward items (don't lose these)

- Supabase Auth email-confirmation re-enable — pre-pilot.
- Orphaned invite-stub cleanup sweep; standalone admin merge tool — post-MVP.
- SMS magic-link invite/sign-in — later milestone.
- Deck PII / data-handling note for the security baseline (decks sent to the model) — before pilot.
- Extractor large-deck timeout host — decided in Step 5; confirm capacity before pilot.
