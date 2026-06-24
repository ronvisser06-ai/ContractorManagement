# How Design — QR Code & On-Site Verification Security

## Document Information

| Field | Value |
|-------|-------|
| **Document** | HowDesign-QRVerification.md |
| **Version** | 2.0.0 |
| **Status** | Draft for review |
| **Last Updated** | 2026-06-23 |
| **Layer** | Second "How" design area. |
| **Companion docs** | HowDesign-DataModel.md (`qr_proofs`, `qr_scans`, `orientation_lockouts`, `access_revocations`, `orientation_completions`), FunctionalOverview.md, ExecutionPlan.md, DesignRationalization.md. |
| **Unblocks** | Milestones M3 (QR issuance) and M4 (foreman verification). |
| **Revision note** | v2.0 replaces the per-site, QR-centric model with a **worker-centric, single-QR** model resolved against the foreman's active site (DesignRationalization.md, decision #12). This removes the "wrong QR for this site" failure mode and the `not_authorized` scan result, adding `incomplete`. |

> Core model (confirmed): a worker carries **one** permanent, opaque QR. It reveals nothing on its own. At scan time, an **authenticated foreman with an active site set** resolves that worker's orientation status **for the foreman's site**. Validity is computed live; every scan is logged.

---

## 1. Why worker-centric

A worker may be cleared at many sites for many clients. A per-site QR forced the worker to find and present the exact right code at each gate — a real failure mode in the field (multiple codes in email/Photos, sun, gloves) and a drag on the 2-second verification target. Because verification is **authenticated and the foreman's site is known server-side**, the QR does not need to encode the site at all: one code identifies the worker, and the foreman's context selects which completion to evaluate. One code works at every gate.

---

## 2. Threat model

| Threat | Mitigation |
|--------|-----------|
| **PII leakage** (a scanned/shared QR exposes worker name, company) | Nothing is returned without an authenticated foreman session with an active site. Unauthenticated scans see a neutral landing page only. |
| **Enumeration / scraping** | Opaque ≥160-bit tokens (no guessable component); no listing endpoint; resolution requires an authorized foreman; rate limiting. |
| **Token theft via DB compromise** | Tokens are **stored hashed**; the raw token exists only in the QR image. A DB leak yields no usable tokens. |
| **Token leakage in transit/logs** | TLS 1.3 only; token sent in a POST body (not query string); landing page sets `Referrer-Policy: no-referrer`. |
| **Cross-client linkage via a single code** | The code resolves only to the *scanning foreman's* site/org context; a foreman only ever sees their own site's status, never the worker's standing with other clients. |
| **QR sharing / impersonation** | Partially mitigated in MVP (§9): scan is authenticated and logged, foreman sees the worker name and can ask for ID. Photo-based visual check is **deferred** (no worker photos in MVP). |
| **Stale clearance after revocation/expiry/lockout** | Status is computed live at every scan; revocation, expiry, and lockout take effect instantly without reissuing the QR. |
| **Lost/leaked QR** | The token can be **reissued** (rotated), invalidating the old one. |

Out of scope for MVP: offline scanning (deferred native app), dynamic/expiring QR codes, photo-on-result verification.

---

## 3. What the QR encodes

The QR image encodes a single URL:

```
https://verify.<app-domain>/v/<token>
```

- `<token>` — a random, URL-safe, **≥160-bit** opaque string identifying **one worker**. No site/org/worker identifier is embedded; it is not derivable or guessable.
- Issued **once per worker** (on first orientation pass, or at account creation), reused at every site/client. Delivered by email or SMS; a Contractor Admin can hand it out for workers without their own device.

### Token at rest
- The raw token is **never stored**. `qr_proofs.token` holds `HMAC-SHA256(server_pepper, raw_token)`. Scan-time lookup hashes the presented token and matches the indexed hash.
- The server pepper lives in secret config, not the database.

---

## 4. Verification flow (authenticated, worker-centric)

```
0. Foreman opens the PWA, signs in, and sets their ACTIVE SITE (one of their assigned sites).
1. Worker presents their single QR (phone screen or print-out).
2. Foreman scans it in-app; the app sends POST /api/verify { token } (active_site implied by session).
3. Server:
   a. hash(token) → qr_proofs → worker user_id.                     Miss → NOT_FOUND.
   b. Authorize: caller holds the foreman role for active_site (site_foremen),
      or is a client_admin of that site's org.                       Fail → 403 (not a scan result).
   c. Compute live status of (worker, active_site) (§5).
   d. Return the result payload (§6); write a qr_scans row for every outcome.
```

A **generic camera app** (not the PWA) that opens `/v/<token>` lands on a **neutral page** — "Contractor verification — open the [App] and sign in to verify." No PII, no status, no confirmation the token is even valid.

---

## 5. Live status computation (for the foreman's active site)

Given the resolved `worker user_id` and the foreman's `active_site`:

```
1. Revocation:  active access_revocations for (user_id, site.org_id)
                where scope = org_wide OR site_id = active_site     → REVOKED
2. Completion:  current orientation_completion for (user_id, active_site, is_current, passed)
                  none / not passed / active lockout / requalification pending → INCOMPLETE
3. Expiry:      completion.expires_at < now()                       → EXPIRED
4. Otherwise                                                        → ACTIVE
```

- **INCOMPLETE** covers the common "known worker, not cleared here yet" cases — never started, locked out, or must requalify after a version bump — and is deliberately distinct from **NOT_FOUND** (an unrecognized code). This was decision #18.
- Revocation is evaluated first so a withdrawal always wins.
- Because this runs at scan time, expiry/revocation/lockout are effective immediately; the QR never changes.

---

## 6. Verification result payload (authorized foreman, MVP)

| Field | Notes |
|-------|-------|
| worker_name | given + family name |
| company_name | the worker's company active on this site (or companies, if more than one is active here) |
| status | `ACTIVE` \| `EXPIRED` \| `REVOKED` \| `INCOMPLETE` \| `NOT_FOUND` |
| site_name | the foreman's active site (so the foreman sees what was evaluated) |
| completed_at / expires_at | from the current completion (when present) |
| score | quiz score (when present) |

No worker photo in MVP (decision #6). Photo-on-result is a deferred enhancement.

---

## 7. Reissue on compromise (decision #5)

Normal operation issues the token once. As an exceptional control, a **Client Admin** or the **worker** can reissue: a new random token replaces the stored hash on the same `qr_proofs` row (status of the old becomes `reissued_superseded`), and the QR is re-delivered (email/SMS, or re-print via Contractor Admin). The old token no longer resolves. Reissue is logged (actor, time, reason). The worker keeps the same single code model — only the token value rotates.

---

## 8. Anti-abuse controls

- **Rate limiting** on `/api/verify` per foreman session and per IP; anomalous bursts throttled and flagged.
- **Full scan logging** including `incomplete` and `not_found`; logs record the resolved active site.
- **No enumeration surface**: the only resolution path is authenticated `/api/verify`; no endpoint lists workers or tokens.
- **Transport**: TLS 1.3; token in POST body; `Referrer-Policy: no-referrer` and no-store caching on the landing page.

---

## 9. Fraud residual risk in MVP (no photo)

With worker photos out of scope, the visual identity check is unavailable, so the residual exposure is **a worker presenting another worker's QR**. Remaining mitigations: verification is authenticated and **logged** (auditable); the foreman sees the worker **name** and can ask for matching photo ID; reissue limits the blast radius of a leaked code. This residual risk is **accepted for MVP**. The deferred **fraud/anomaly-detection agent** (DesignRationalization.md Part B) is the planned compensating control — e.g. one code resolving at two distant sites within minutes, or implausibly fast completions.

---

## 10. Endpoints (sketch)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/verify { token }` | Foreman (with active site) or Client Admin | Resolve worker → authorize for active site → return status; writes `qr_scans` |
| `GET /v/:token` | none | Neutral landing page; no data, no validity signal |
| `POST /api/foreman/active-site { site_id }` | Foreman | Set the active site for this session/device |
| `POST /api/qr/:proofId/reissue` | Client Admin (org) or worker | Rotate token, re-deliver |
| QR issuance | system (service role) | On first orientation pass / account creation: create `qr_proofs`, generate image, deliver |

---

## 11. Data model touch-points

Uses tables from HowDesign-DataModel.md (v1.1):

- **`qr_proofs`** is keyed **per worker** (`unique(user_id)`); `token` stored hashed.
- **`qr_scans.result`** enum: `active, expired, revoked, incomplete, not_found`; `site_id` records the foreman's resolved active site. (`not_authorized` is no longer a scan result — unauthorized callers get a 403.)
- **`orientation_lockouts`** feeds the `INCOMPLETE` determination.
- **`users.photo_asset_id`** remains in schema but is unused in MVP.

---

## 12. Deferred (post-MVP)

- Worker photo capture and photo-on-result visual verification.
- Offline scanning with later sync (native app).
- Dynamic / time-limited QR tokens.
- Fraud/anomaly-detection agent (compensating control for the no-photo residual).

---

*End of HowDesign-QRVerification.md*
