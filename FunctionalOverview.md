# Contractor Orientation Management — Functional Overview ("What We're Building")

## Document Information

| Field | Value |
|-------|-------|
| **Document** | FunctionalOverview.md |
| **Version** | 1.1.0 |
| **Status** | Draft for review |
| **Last Updated** | 2026-06-23 |
| **Purpose** | Defines *what* the application does — its capabilities, roles, and behaviors — independent of *how* it is built. The "How" lives in ExecutionPlan.md and the contracts spec. |
| **Revision note** | v1.1.0 incorporates the design-rationalization deep dive (see DesignRationalization.md): worker-centric single QR, per-worker site activation, SMS/assisted completion, lockout handling, requalification notice, and video-skip behavior. |
| **Scope** | Orientation MVP. Mobile apps and Certs Check are out of scope (see Section 9). |

> This document is capability-focused. It deliberately contains no technology, architecture, or implementation detail. Where a behavior is still assumed rather than confirmed, it is marked **(CONFIRM)**.

---

## 1. What the product is

A web platform that ensures every contractor who arrives at an industrial site has completed that site's required safety orientation, and lets an on-site supervisor verify it in seconds by scanning a code. It replaces paper sign-off sheets and tracking spreadsheets with online orientations, scored assessments, and a scannable proof of completion.

The platform is **multi-tenant and multi-site**: many independent client organizations, each operating multiple sites, each site with its own orientation. A single contractor can hold completions for several different clients at the same time.

---

## 2. Roles (RBAC)

Access is governed by roles. **Roles are additive** — one person may hold several (e.g. a Client Admin who is also a Content Developer). Authoring and approval are deliberately separable: the right to *approve* content is its own role, so it can be held by a different person than the author.

| Role | What this role can do |
|------|----------------------|
| **Client Admin** | Set up the organization and its sites; manage foremen and site coverage; bring contractor companies into the system; assign orientations to sites; set per-site orientation expiry; revoke contractor access; reset locked-out workers (single or in bulk). |
| **Content Developer** | Author and edit orientation content and its quiz; preview the contractor experience before publishing. |
| **Content Approver** | Approve (sign off) and publish an orientation so it can go live. A separate permission from authoring; may be held by the same or a different person. |
| **Site Foreman** | Set their active site; scan a contractor's code on site and see the worker's orientation status for that site; view the list of contractors active on their site(s); reset a locked-out worker. |
| **Contractor Admin** | Create and manage the contractor company profile; enroll and invite the company's workers (by email or SMS); mark which workers are active on which sites (crew dispatch); assist a worker through completion on a shared device; track progress; hand out a worker's QR proof on their behalf when needed. |
| **Contractor User** | Complete assigned orientations, take quizzes, and carry the single QR proof of completion. |

---

## 3. Functional capabilities

### 3.1 Organization & site setup
A client can create their organization, define their physical sites, and manage which foremen cover which sites.

### 3.2 Contractor network (lightweight CRM)
A client invites contractor companies into the system. A contractor company builds a profile (trades / work types, contact info, logo), adds its workers, and invites them **by email or SMS** (a mobile number is captured for every worker, so the hardest-to-reach workers still get a usable invite and sign-in link). Each worker is tracked through a lifecycle so both the contractor company and the client can see who is fully onboarded versus still outstanding:

`Entered → Invited → Logged In → Account Created`

A single worker has **one identity** that can carry relationships with multiple clients at once — one login, many client relationships, many orientations, and **one** QR proof. A worker may hold more than one verified email and consolidate them under that single identity. To prevent accidental duplicate accounts, registration performs a **soft match** on mobile number and name and prompts "is this you?" before creating a new identity; admins also have a merge tool. Because a worker may work for several contractor companies, Foremen and Client Admins can see **how many contractor companies a given worker is associated with**.

### 3.3 Orientation creation & approval
A site's orientation is a structured package of content — sections, text, images, video, hazard information — paired with a quiz. The system can produce a first draft of the content and quiz automatically from source material (such as an existing slide deck), but a person always reviews and corrects it. An orientation goes live only when someone holding the **Content Approver** role signs off and publishes it.

A published orientation is **frozen and versioned**: later edits create a new version, and prior versions are retained so each completion record always reflects exactly the version a worker was tested against.

### 3.4 Orientation assignment
Each site has **exactly one active published orientation** at a time. The Client Admin assigns a published orientation to one or more sites; that defines what every contractor working at those sites must complete. *(Trade-specific or multiple-orientation-per-site behavior is out of scope for MVP.)*

### 3.5 Site association & crew activation — who must complete what
Association works in two layers:

- **Eligibility (company level):** a contractor company becomes eligible for a site when the Client Admin invites/assigns the company to that site.
- **Activation (worker level):** the Contractor Admin marks which of the company's workers are **active on a given site** (i.e. actually dispatched there). The foreman's on-site list and the site's compliance numbers are based on the **activated** workers, not on every employee of every assigned company — so a 200-person company sending a 10-person crew does not create 190 phantom non-compliant workers.

An activated worker is required to complete that site's orientation.

### 3.6 Orientation delivery & assessment
A contractor works through their assigned orientation page by page — reading content, watching video, viewing documents — answering questions inline and in an end-of-module quiz. The system scores them against a configurable passing threshold, shows running progress, allows a limited number of retries, and returns a clear pass or fail.

- **Video integrity:** the option to advance past a required video is unavailable until the video has been viewed. If a worker chooses to skip, they are first warned ("Skipping the video will restart the process") and, on confirming, are returned to the start of the orientation.
- **Completion access:** completion does not require the worker's own email or device. A worker can be invited and sign in via SMS magic-link, and a Contractor Admin can **assist a worker through the orientation on a shared device ("kiosk" mode)** — important for workers without their own email or smartphone.
- **Lockout:** a worker who exhausts the allowed attempts enters a **Locked Out** state and cannot continue until reset (see 3.9).

### 3.7 Proof of completion (QR)
A worker has **one QR code** — a single permanent, opaque pointer tied to their identity, not to a particular site. It is delivered by email or SMS, and a Contractor Admin can hand it out on the worker's behalf for workers without their own device. The code reveals nothing by itself; what it *means* is resolved live at scan time for the scanning foreman's site (see 3.8). The token can be reissued (rotated) if a worker's QR is lost or leaked.

### 3.8 On-site verification
A foreman sets their **active site**, then scans a worker's single QR. The system resolves the worker's orientation status **for that foreman's site** and shows the worker's name, company, and status — **Active, Expired, Revoked, Incomplete, or Not Found** — with completion and expiry dates and score. The worker no longer has to find "the right QR for this site"; one code works at every gate. Every scan is logged (who scanned, when, result).

### 3.9 Compliance lifecycle
- **Expiry:** each site has a Client-Admin-set default duration (e.g. 12 months), applied to a worker's completion. The platform tracks what is current, expiring, and overdue.
- **Requalification on new versions:** when a new orientation version is published, the approver chooses, at publish time, who must redo it — **everyone re-qualifies**, **only those affected by changed content**, or **no one** (cosmetic change). When requalification is required, affected workers are notified that they must retake the updated orientation, and their company receives a summary of all workers who must requalify.
- **Lockout reset:** when a worker locks out, the foreman and Client Admin are notified. The foreman can reset a locked-out worker from their on-site list; the Client Admin sees the full list and can reset one, some, or all.
- **Revocation:** a Client Admin can revoke a worker's access to a single site, with the option to revoke across all of that client's sites at once. A revoked status shows immediately on scan.

### 3.10 Visibility & reporting
Each role sees a dashboard suited to it: a Client Admin sees completion across their sites and contractor companies; a Contractor Admin sees their own workers' status; a Content Developer sees how an orientation and its individual questions are performing. Compliance data can be exported.

---

## 4. Key states

**Worker onboarding lifecycle:** `Entered → Invited → Logged In → Account Created`

**Attempt state:** a worker may also be **Locked Out** (allowed attempts exhausted) until a foreman or Client Admin resets them.

**Orientation status for the foreman's site (shown on scan):**

| Status | Meaning |
|--------|---------|
| **Active** | Completed, passed, and within the expiry window for this site. |
| **Expired** | Previously completed but past this site's expiry duration. |
| **Revoked** | Access withdrawn by the Client Admin. |
| **Incomplete** | Known worker, but no current passing completion for this site (not yet done, locked out, or requalification pending). |
| **Not Found** | The scanned code is not recognized. |

---

## 5. Notifications (MVP)

Primary channel is **email**; **invitations and sign-in links are also available by SMS** (mobile is captured for every worker). The platform notifies on the following events:

| Event | Recipient | Channel |
|-------|-----------|---------|
| Contractor company invited | Contractor Admin | Email |
| Worker invited | Contractor User | Email / SMS |
| Sign-in link (magic-link) | Contractor User | Email / SMS |
| Orientation completed | Worker (and visible to admins) | Email |
| QR proof issued | Worker | Email / SMS |
| Requalification required (new version) | Worker | Email / SMS |
| Requalification summary (affected workers) | Contractor Admin | Email |
| Worker locked out | Site Foreman, Client Admin | Email |
| Expiring — 30 days | Worker | Email / SMS |
| Expiring — 14 days | Worker | Email / SMS |
| Expiring — 7 days | Worker | Email / SMS |
| Expired | Worker | Email / SMS |
| Access revoked | Worker | Email |

---

## 6. End-to-end flow

A Client Admin sets up a site and assigns its orientation → invites a contractor company to the site → the company enrolls and invites its workers (email or SMS) and marks who is active on the site → each worker completes the orientation and passes the quiz → the worker holds a single permanent QR proof → a foreman, with their active site set, scans it and sees the worker's status for that site → the platform keeps that status current, flags it ahead of expiry, prompts requalification on new versions, and reflects any revocation immediately.

---

## 7. Confirmed decisions (review log)

| # | Decision |
|---|----------|
| 1 | Content approval is its own additive RBAC role (**Content Approver**); author and approver may differ. |
| 4 | A worker is associated to a site when their company is invited/assigned to it; that drives the "expected on site" list and the orientation requirement. |
| 5 | One worker identity across all clients; many client relationships, orientations, and QRs. Foremen and Client Admins can see how many contractor companies a worker is associated with. |
| 2 | Roles are additive — one user may hold several. |
| 3 | Exactly one active published orientation per site (MVP). |
| 6 | Orientation expiry is a per-site default set by the Client Admin, applied at completion. |
| 7 | On new version publish, the approver chooses: everyone re-qualifies / only affected content / no one. |
| 8 | Revocation is per site, with an option to revoke across all of a client's sites. |
| 9 | Contractor Admin can hand out a worker's QR on their behalf (no-email workers) — in MVP. |
| 10 | ~~QR per worker × client × site~~ **Revised (v1.1):** one QR per worker, worker-centric resolution against the foreman's active site. Generated once, permanent, reissuable; validity computed live at scan. |
| 11 | MVP notifications: email primary, SMS for invites/sign-in/QR/expiry. Adds requalification-required, requalification summary, and worker-locked-out events (see §5). |
| **Deep-dive rationalization (v1.1) — see DesignRationalization.md** | |
| 12 | QR collapses to one code per worker; worker-centric resolution (supersedes #10). |
| 13 | SMS magic-link invite + sign-in; Contractor-Admin-assisted "kiosk" completion for no-email/no-device workers. |
| 14 | Two-layer site model: company eligibility + per-worker crew **activation**; foreman list and compliance counts use activated workers. |
| 15 | Identity de-duplication: soft match on mobile + name at registration, plus an admin merge tool. |
| 16 | Requalification triggers a worker notice and a company summary. |
| 17 | Max-attempts → **Locked Out**; foreman or Client Admin (single/bulk) can reset; both are notified. |
| 18 | Scan status adds **Incomplete**, distinct from **Not Found**. |
| 19 | Video integrity: skip is hidden until the video completes; choosing skip warns and restarts the orientation. |
| 20 | Terminology: the orientation approver is the **Content Approver** (the pipeline's "Safety Professional"). |

---

## 8. Open items to confirm

All functional decisions from the review are now confirmed. No "What"-level items remain open. Remaining open questions are "How"-level (data model, access rules) and are tracked in ExecutionPlan.md §5–§6.

---

## 9. Out of scope (MVP)

Not part of what we are building now, though part of the longer vision:

- **Mobile applications** (contractor app, foreman native app).
- **Certs Check** — certification & licensing verification, AI certificate capture, compliance engine, combined orientation + certification status, daily deficiency reports.
- Trade-specific or multiple orientations per site; jurisdiction-driven requirements.
- Advanced question types, multi-language content, SSO, bulk import, offline scanning, digital wallet, badge printing.

---

*End of FunctionalOverview.md*
