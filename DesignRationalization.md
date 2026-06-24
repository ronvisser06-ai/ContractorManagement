# Design Rationalization — Deep-Dive Findings & Decisions

## Document Information

| Field | Value |
|-------|-------|
| **Document** | DesignRationalization.md |
| **Version** | 1.0.0 |
| **Status** | Decisions accepted; folded into the design docs |
| **Last Updated** | 2026-06-23 |
| **Purpose** | Records the cross-document deep dive: the workflow/UX tensions found, the decision taken on each, and the disposition of additional AI-agent opportunities. The reasoning lives here; the resulting behavior lives in the design docs. |
| **Docs revised as a result** | FunctionalOverview.md (v1.1), HowDesign-DataModel.md (v1.1), HowDesign-QRVerification.md (v2.0), orientation_pipeline_contracts_v0.1.md (§7 added), ExecutionPlan.md (v1.1). |

---

## Part A — Workflow & UX rationalization

### The three that mattered most

**1. Per-site QR → worker-centric single QR.**
*Tension:* a per-site QR forced a worker who works across clients/sites to find and present the exact right code at each gate — a field failure mode that undermines the 2-second verification target. Because verification is authenticated and the foreman's site is known server-side, the QR never needed to encode the site.
*Decision:* **one QR per worker; worker-centric resolution against the foreman's active site.** Supersedes the earlier per-worker×client×site decision. Removes the "wrong QR for this site" case and the `not_authorized` scan result; adds `INCOMPLETE`.
*Where:* FunctionalOverview §3.7–3.8, HowDesign-QRVerification v2.0, HowDesign-DataModel `qr_proofs`.

**2. The no-email/no-device worker couldn't complete the orientation.**
*Tension:* QR hand-out solved delivery, but completion still assumed an email + account + personal device. That population is High-likelihood in the risk register.
*Decision:* **SMS magic-link for invite + sign-in** (mobile is captured for every worker), plus a **Contractor-Admin-assisted "kiosk" completion** mode on a shared device. Expected to be the single biggest lever on the >90% completion metric.
*Where:* FunctionalOverview §2, §3.2, §3.6, §5; HowDesign-DataModel identity flow + `invitations.channel`.

**3. Company-level site association inflated "expected" and compliance numbers.**
*Tension:* associating a whole company to a site made every employee "expected" everywhere the company worked, creating phantom non-compliance and noisy foreman lists.
*Decision:* keep company assignment as **eligibility**, add a per-worker **activation** layer (crew dispatch). Foreman lists and compliance denominators use the **activated** set.
*Where:* FunctionalOverview §3.5; HowDesign-DataModel `site_worker_activations` + revised `expected_on_site` view.

### The shorter list

| # | Tension | Decision |
|---|---------|----------|
| 4 | Reconciliation only matched on email → silent duplicate identities | Soft match on **mobile + name** at registration ("is this you?"), plus an **admin merge tool**. |
| 5 | No "requalification required" notification on a version bump | Worker is **notified to retake** the updated orientation; company gets a **summary** of all workers who must requalify. |
| 6 | No path to clear a max-attempts lockout | Worker enters **Locked Out**; foreman + Client Admin notified; **foreman resets** from the on-site list, **Client Admin** resets one/some/all. |
| 7 | `NOT_FOUND` conflated "unknown code" with "known worker, not done" | Add **`INCOMPLETE`** as a distinct scan status. |
| 8 | Approval-gate editor could regrow into a WYSIWYG builder | **Bounded editor scope** written into pipeline contracts §7 (allowed/excluded lists). |
| 9 | Video-skip undermined the compliance claim | Skip is **hidden until the video completes**; if skipped, warn ("Skipping the video will restart the process") and **restart** the orientation. |
| 10 | "Safety Professional" vs "Content Approver" naming | Standardize on **Content Approver** (pipeline doc updated). |

---

## Part B — Additional AI-agent opportunities (disposition)

| Agent | Disposition |
|-------|-------------|
| **Adaptive remediation** (re-teach + re-test the missed concept) | **In development pipeline** (post-MVP enhancement). |
| **Client setup assistant** (conversational site profiling) | **In development pipeline** (post-MVP enhancement). |
| **Orientation help agent** (in-experience copilot) | **Parking lot** — explore once core development is underway. |
| **Regulatory-change monitor** (BC/AB/SK OHS) | **Parking lot** — explore once core development is underway. Genuine moat. |
| **Fraud / anomaly-detection agent** | **Parking lot** — planned compensating control for the no-photo QR residual. |
| Broader ingestion / localization / analytics-narrative | Noted, not scheduled. |
| Certificate-extraction agent | Remains the marquee CertsCheck future item (unchanged). |

**Sequencing intent:** get core development underway, then explore the **orientation help agent** and the **regulatory-change monitor** first among the parked items.

---

## Change-impact summary

| Document | Change |
|----------|--------|
| FunctionalOverview.md → **v1.1** | Worker-centric QR; crew activation; SMS/kiosk; lockout; requalification notice; video integrity; expanded roles & notifications; review log items 12–20. |
| HowDesign-DataModel.md → **v1.1** | `qr_proofs` keyed per worker; `qr_scans` enum (`incomplete`, drop `not_authorized`); `site_worker_activations`; `orientation_lockouts`; notification event types; `invitations.channel`; identity soft-match/merge. |
| HowDesign-QRVerification.md → **v2.0** | Full rewrite to worker-centric single-QR with foreman active-site resolution. |
| orientation_pipeline_contracts_v0.1.md | Added §7 bounded approval-editor scope; "Safety Professional" → "Content Approver". |
| ExecutionPlan.md → **v1.1** | §4a rationalization deltas; §7a AI-agent roadmap; resolved-gap status note. |

---

*End of DesignRationalization.md*
