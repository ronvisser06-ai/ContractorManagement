# Contractor Orientation Management

A multi-tenant web platform that ensures every contractor arriving at an industrial site has completed that site's required safety orientation, and lets a foreman verify it in seconds by scanning a single QR code. Orientations are generated from an uploaded deck by an AI pipeline, reviewed and approved by a human, then published as immutable versioned packages. Workers complete them online (or via assisted/kiosk + SMS), pass a quiz, and carry one QR proof resolved live at the gate.

> **Start here:** [`CLAUDE.md`](./CLAUDE.md) is the project guide and the source of truth for the stack, milestones, standards, and the Jacques coaching workflow. Read it first.

## Status

Design phase complete. **Next build: M0 — Foundations & Walking Skeleton.** The first feature is scoped in [`Feature1-Foundation-Brief.md`](./Feature1-Foundation-Brief.md).

## Documentation

| Doc | Role |
|-----|------|
| [FunctionalOverview.md](./FunctionalOverview.md) | The "What" — capabilities, roles, behaviors |
| [ExecutionPlan.md](./ExecutionPlan.md) | The "How" — milestones M0–M5, stack, AI-agent roadmap |
| [orientation_pipeline_contracts_v0.1.md](./orientation_pipeline_contracts_v0.1.md) | Generation-pipeline data contracts + bounded approval editor |
| [HowDesign-DataModel.md](./HowDesign-DataModel.md) | Schema, three-domain tenancy, RLS, identity |
| [HowDesign-QRVerification.md](./HowDesign-QRVerification.md) | Worker-centric single-QR verification |
| [DesignRationalization.md](./DesignRationalization.md) | Why key decisions are what they are |
| [Feature1-Foundation-Brief.md](./Feature1-Foundation-Brief.md) | Plan-Mode brief for the first feature |
| [BUILDLOG.md](./BUILDLOG.md) | Session log (update after every feature) |
| [JACQUES.md](./JACQUES.md) · [JACQUES_QUICK_START.md](./JACQUES_QUICK_START.md) | The coaching system & the 20 rules |

## Tech stack

Next.js 14 (App Router) + TypeScript · Tailwind + shadcn/ui · Supabase (Postgres + Auth + Storage + Realtime) · Drizzle · Inngest · Python deck extractor · Anthropic API · Resend + SMS · Vercel + Sentry. See [`CLAUDE.md §3`](./CLAUDE.md).

## Getting started

The application is built feature-by-feature under Jacques coaching. To begin:

1. Read `CLAUDE.md`, then `Feature1-Foundation-Brief.md`.
2. In Claude Code: **"Jacques, let's build Feature 1, Step 1 only"** — scaffold + deploy a hello page to Vercel with Sentry.
3. Work the build order one step at a time: test in the browser, commit each step, update `BUILDLOG.md`.

One feature per conversation (Rule 18). Ship before perfect (Rule 20).
