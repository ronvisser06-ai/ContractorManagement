# M1 — Tenancy, Sites & Contractor CRM (Plan-Mode Brief)

> **Milestone goal:** bring the *contractor* side of the platform to life — clients invite contractor companies; companies register, profile, and enroll workers under a single de-duplicated identity; workers move through the onboarding lifecycle; and crews are activated to specific sites (driving the foreman's "expected on site" list and compliance counts).
>
> **Scope decisions (locked):** invitations are delivered as **dev-mode links** (the app shows/logs the tokenized link) while the CRM is built; **real email (Resend)** is wired as the final isolated step. **SMS magic-link is deferred to a later milestone.** This keeps provider setup out of the way of the CRM logic.

---

## Working agreement (strict — do not deviate)

- The whole milestone is the destination; reach it **one step at a time, in order**.
- **One step = one Claude Code prompt.** Steps are never bundled.
- A step is **not done** until: it works in the browser (Rule 7); TypeScript strict + lint + production build are clean; an RLS/automated test covers it where applicable; it's committed and pushed (Rule 9); BUILDLOG is updated (Rule 19).
- **The next step does not begin until the current step meets that bar.** Jacques checks between steps.
- Fresh Claude Code conversation when context gets heavy (Rule 18); BUILDLOG is the bridge.
- Splitting a step **smaller** is always allowed (Rule 10); merging steps **bigger** is not.

---

## The three questions (locked)

1. **What:** the contractor + bridge domains from the data model, built for real — companies, workers, the single-identity model, client↔company links, site↔company assignment, and crew activation.
2. **Who:** Contractor Admins (company + workforce), Client Admins (inviting companies, viewing the CRM), and workers (self-registration).
3. **Done:** Client Admin invites a company → company registers, profiles, adds workers → workers register and de-duplicate to one identity → company activates a crew on a site → that crew appears on the foreman's "expected on site" list and in the site's compliance counts.

## Canonical references

`HowDesign-DataModel.md` §2 (identity), §3.3–3.4 (contractor + bridge tables), §4.2–4.5 (contractor/bridge RLS, expected-on-site view, cross-company view), §5 (reconciliation flow) · `FunctionalOverview.md` §2 (roles), §3.2 (CRM), §3.5 (crew activation) · `DesignRationalization.md` (#4, #5, #14, #15) · `CLAUDE.md`.

---

## Build order (one step → test → commit; Rules 6, 7, 9)

**Step 1 — Contractor + bridge schema + RLS.**
Migration for the new tables per the data model: `contractor_companies`, `company_memberships` (with enums: `company_role`, `onboarding_status`, membership status; `contractor_ref`), `user_emails`, `client_company_links`, `site_company_assignments`, `site_worker_activations`, `invitations` (include the `channel` column even though SMS is deferred). Enable **relationship-derived RLS** (§4.2–4.3) with the helper functions (`user_company_ids`, `user_linked_org_ids`, `org_linked_company_ids`). Add an **automated cross-tenant test**: a company's data is visible to its own members and only the *sliced* view to a linked client; a second, unrelated client sees nothing. *Done:* tables + RLS live, test green.

**Step 2 — Client invites a contractor company.**
Client Admin "Contractors" page: list linked companies + an invite form (company contact email). Inviting creates an `invitations` row (type=company, tokenized) and a `client_company_links` row (status=invited). **Dev-mode delivery:** the app displays/logs the tokenized link (no email yet). *Done:* a Client Admin can issue a company invite and see it pending; the link is shown.

**Step 3 — Company registration + profile.**
Opening the invite link lets the invitee register: creates the first **Contractor Admin** user, the `contractor_companies` row, a `company_memberships(contractor_admin)`, and flips the `client_company_link` to active — atomically (security-definer RPC, same pattern as `create_organization`). Company profile: trade/work types, contact info, logo upload. *Done:* invite link → registered company + Contractor Admin → profile editable; the client sees the company as active.

**Step 4 — Worker enrollment, invite, soft-match registration, lifecycle.**
Contractor Admin adds workers (given/family name, email, mobile) and invites them (tokenized dev-mode link); each creates a `company_memberships(worker, onboarding_status=invited)`. Worker opens link → registers with the **soft-match guard** (mobile + name → "is this you? sign in instead") to avoid duplicate identities; on new registration, create `users` + `user_emails`. Track the lifecycle `entered → invited → logged_in → account_created` per membership. CRM lists: Contractor Admin worker roster with status; Client Admin sees linked companies + their workers (sliced). *Done:* full worker invite → register (deduped) → status visible to both sides.

**Step 5 — Crew activation, expected-on-site, cross-company view.**
`site_company_assignments`: Client Admin assigns a linked company to a site (eligibility). `site_worker_activations`: Contractor Admin marks which workers are active on a site (the crew). The foreman's **"expected on site"** list and the site's compliance denominator use the **activated** set (the derived view from §4.5). Add the **cross-company worker view** (§4.4): Client Admin/Foreman see the total company count + names only of companies that also link to their org. *Done:* assign company → activate a crew → crew shows on the foreman list; cross-company view returns the correct sliced result.

**Step 6 — Identity consolidation (lean).**
Worker can add and verify an additional email/phone on their profile, linking any pending membership that targeted it. A privileged **admin merge tool** to merge two identities discovered to be the same person (re-points memberships/completions/QR to the surviving `user_id`, logged). Keep it minimal — soft-match (Step 4) already prevents most duplicates; this is the cleanup path. *Done:* add-email consolidation works; an admin can merge two test identities.

**Step 7 — Real email delivery (Resend).**
Replace dev-mode link display with **Resend** email sending for the invite events (company invited, worker invited). Set up the Resend account/API key/domain (the one provider-setup step, isolated at the end). *Done:* a real invite email is delivered and its link completes registration. *(SMS magic-link remains deferred to a later milestone.)*

---

## Definition of Done (whole milestone)

End-to-end: Client Admin invites a company → company registers + profiles + enrolls workers (deduped to one identity) → activates a crew on a site → crew appears on the foreman's expected list and compliance count → invites arrive by real email. RLS/automated tests green across the new tables; TypeScript strict + lint + build clean; deployed; BUILDLOG updated per step. Then `Jacques, ship check`.

## Carried-forward items (don't lose these)

- **SMS magic-link** invite/sign-in (for no-email workers) — deferred to a later milestone.
- **Re-enable email confirmation** (Supabase Auth) before pilot — relates to Step 7.
- **M2-deploy tasks** (Inngest Cloud + Python extractor prod) — parked for M2.
- Site detail fields (`orientation_validity_months`, `province`, `address`) — columns exist; surface in the site form when M3 (expiry) needs them.
