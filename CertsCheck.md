# Certs Check — Certifications & Licensing Compliance Module

## Document Information

| Field | Value |
|-------|-------|
| **Document** | CertsCheck.md |
| **Version** | 1.0.0 |
| **Status** | Draft — Future Enhancement |
| **Last Updated** | 2026-02-26 |
| **Related Documents** | DevelopmentPlan.md, WorkflowandRequirements.md, OrientationContentBuilder.md |
| **Dependency** | Mobile Application (Contractor & Foreman) |

---

## 1. Overview

**Certs Check** is a certification and licensing compliance module that extends the Contractor Orientation Management Solution to verify that individual contractors possess the required, valid industry certifications and licenses before and during site access.

While the Orientation module ensures contractors understand site-specific hazards and procedures, Certs Check ensures they hold the foundational industry credentials (H2S Alive, First Aid, Fall Protection, Confined Space, WHMIS, TDG, etc.) that provincial OHS regulations and industry standards require.

The module introduces:
- **AI-powered certificate capture** — contractors photograph their certificates; the system extracts data automatically
- **Certification requirement matrices** — Client Admins define what's required per site based on work types and hazard profiles
- **Dynamic certification groups** — master lists that propagate automatically to assigned sites
- **Integrated QR code verification** — foremen see both orientation AND certification status in a single scan
- **Proactive compliance management** — automated expiry tracking, contractor notifications, and daily foreman deficiency reports
- **Mobile application** — purpose-built for contractor certificate capture and foreman field verification

---

## 2. Mobile Application Requirement

Certs Check introduces functionality that requires a dedicated mobile experience for two user roles:

### 2.1 Why Mobile Is Now Required

| Function | Why Web Isn't Enough |
|----------|---------------------|
| Certificate photography | Contractors need to use their device camera to photograph physical cards/certificates — requires native camera integration with guided capture (alignment, lighting, focus) |
| Push notifications | Expiry warnings (3-month, 30-day, 7-day) and compliance alerts need push notification delivery, not just email |
| QR code scanning | Foremen need fast, reliable scanning with offline capability for remote sites |
| Daily compliance lists | Foremen need to review contractor deficiency reports on mobile before the workday starts |
| Field conditions | Both roles operate in environments where a full web browser is impractical — gloves, sunlight, limited connectivity |

### 2.2 Mobile App Scope

| Feature | Contractor App | Foreman App |
|---------|:-:|:-:|
| Certificate capture (camera) | ✅ | ❌ |
| View own certifications & status | ✅ | ❌ |
| View own orientation status & QR codes | ✅ | ❌ |
| Receive expiry notifications (push) | ✅ | ❌ |
| Re-photograph expired/rejected certificates | ✅ | ❌ |
| QR code scanning | ❌ | ✅ |
| Combined verification display (orientation + certs) | ❌ | ✅ |
| Daily contractor compliance list | ❌ | ✅ |
| Compliance deficiency alerts (push) | ❌ | ✅ |
| Offline scanning with sync | ❌ | ✅ |

### 2.3 Recommended Approach

| Option | Description | Recommendation |
|--------|-------------|----------------|
| **Progressive Web App (PWA)** | Web-based, installable, camera access, push notifications (limited on iOS) | Good for Rev 1 — fast to build, no app store |
| **React Native / Expo** | Cross-platform native app, full camera/push/offline support | Recommended for Rev 2 — better camera control, reliable push, offline |
| **Native iOS + Android** | Separate native apps | Overkill unless enterprise client demands it |

**Rev 1 Recommendation:** Build as a PWA with camera access and basic push notifications. Plan migration to React Native for Rev 2 when offline scanning and advanced camera features become critical.

---

## 3. Certification Data Model

### 3.1 Certification Definition (Master List)

The Client Admin defines the certifications that exist in their operating environment. These are the *types* of certifications, not the individual contractor records.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID (FK) | Client organization |
| name | String | Certification name (e.g., "H2S Alive") |
| short_name | String | Abbreviation (e.g., "H2S") |
| description | Text | Description of the certification |
| issuing_bodies | JSON Array | Recognized issuing organizations (e.g., ["Energy Safety Canada", "OSSA"]) |
| default_validity_years | Decimal | Standard validity period (e.g., 3.0 for 3 years) |
| validity_type | Enum | FIXED_YEARS, FROM_ISSUE_DATE, NO_EXPIRY, EMPLOYER_DEFINED |
| jurisdiction_notes | Text | Provincial/jurisdictional applicability notes |
| category | Enum | SAFETY, FIRST_AID, ENVIRONMENTAL, TRADE_LICENSE, DRIVER, REGULATORY |
| is_active | Boolean | Whether this cert type is currently in use |
| created_at | Timestamp | Record creation |

**Example records:**

| Name | Issuing Bodies | Validity | Category |
|------|---------------|----------|----------|
| H2S Alive | Energy Safety Canada | 3 years | SAFETY |
| Standard First Aid / CPR Level A | Red Cross, St. John Ambulance, ESC | 3 years | FIRST_AID |
| WHMIS 2015 | Various (employer-delivered) | Employer-defined | REGULATORY |
| Fall Protection | Various accredited providers | 3 years | SAFETY |
| Confined Space Entry | Various accredited providers | 3 years | SAFETY |
| Ground Disturbance Level II | Energy Safety Canada | 3 years | SAFETY |
| Common Safety Orientation (CSO) | Energy Safety Canada | 3 years | SAFETY |
| TDG (Transportation of Dangerous Goods) | Various accredited providers | 3 years | REGULATORY |
| Oilfield Driver Awareness (ODA) | Energy Safety Canada | 3 years | DRIVER |

### 3.2 Certification Groups

Certification Groups allow the Client Admin to bundle certifications into reusable sets that can be assigned to sites.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID (FK) | Client organization |
| name | String | Group name (e.g., "Baseline — All Sites", "Sour Gas Operations") |
| description | Text | Description |
| group_type | Enum | BASELINE, HAZARD_SPECIFIC, TRADE_SPECIFIC, CUSTOM |
| is_master | Boolean | If true, changes propagate automatically to all assigned sites |
| certifications | Array (FK) | List of certification definition IDs in this group |
| created_at | Timestamp | Record creation |

**Example groups:**

| Group Name | Type | Certifications | Assignment |
|------------|------|----------------|------------|
| Baseline — All Workers | BASELINE | CSO, WHMIS, Standard First Aid/CPR, Site Orientation | All sites |
| Sour Gas Operations | HAZARD_SPECIFIC | H2S Alive | Sites with H2S exposure |
| Working at Heights | HAZARD_SPECIFIC | Fall Protection | Sites with elevation hazards |
| Confined Space Work | HAZARD_SPECIFIC | Confined Space Entry | Sites with confined spaces |
| Ground Disturbance | HAZARD_SPECIFIC | Ground Disturbance Level II | Sites with excavation/pipeline work |
| BC Oilfield Driving | HAZARD_SPECIFIC | ODA | BC sites with heavy vehicle operations |
| Hazmat Transport | HAZARD_SPECIFIC | TDG, WHMIS | Sites with dangerous goods transport |

### 3.3 Dynamic Linkage

When a Certification Group is marked as **master** (`is_master = true`):

- Any change to the group (add/remove certifications) is **automatically propagated** to all sites assigned to that group
- Sites do not maintain independent copies of the group — they reference the master
- Changes take effect immediately — contractors at affected sites will see updated requirements on their next login
- Notification sent to Client Admin confirming the change and listing affected sites

### 3.4 Site Certification Profile

The Client Admin configures each site by selecting which Certification Groups apply.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| site_id | UUID (FK) | The site |
| work_types_present | JSON Array | Types of work performed at this site |
| hazards_present | JSON Array | Hazards present at this site |
| certification_groups | Array (FK) | Certification Groups assigned to this site |
| additional_certifications | Array (FK) | Individual certifications added beyond groups |
| created_at | Timestamp | Record creation |

**Workflow:**

```
Step 1: Client Admin opens site profile

Step 2: Selects Work Types present at site
        → e.g., Electrical, Mechanical, Pipefitting, Scaffolding,
          Insulation, Civil, Welding, Instrumentation, General Labour

Step 3: Selects Hazards present at site
        → e.g., H2S Exposure, Working at Heights, Confined Spaces,
          Ground Disturbance, Dangerous Goods Transport, Heavy Vehicles (BC)

Step 4: System auto-suggests applicable Certification Groups
        based on selected work types and hazards

Step 5: Client Admin reviews, adjusts, and confirms
        → Can add additional individual certifications
        → Can remove suggested groups if not applicable

Step 6: Site Certification Profile saved
        → All contractors assigned to this site now have
          these certification requirements applied
```

---

## 4. Contractor Certificate Capture

### 4.1 AI-Powered Certificate Photography

The contractor uses their mobile device to photograph physical certification cards and certificates. The system uses AI (OCR + document intelligence) to extract data automatically.

**Capture Workflow:**

```
Step 1: Contractor opens "My Certifications" in mobile app

Step 2: Taps "Add Certificate" → Camera opens with guided overlay
        → Frame guide shows where to position the card
        → Auto-detect when card is aligned and in focus
        → Capture button (or auto-capture)

Step 3: System processes the image:
        a) Store original photograph (encrypted at rest)
        b) Run OCR to extract text
        c) AI document intelligence identifies:
           - Certificate type / name
           - Issuing body / organization
           - Holder name
           - Date issued
           - Expiry date
           - Certificate / card number
           - Course / class information
        d) Confidence score for each extracted field

Step 4: Extracted data presented to contractor for review
        ┌─────────────────────────────────────┐
        │  CERTIFICATE CAPTURED                │
        │                                      │
        │  Type: H2S Alive          [✓ 98%]   │
        │  Issued by: Energy Safety  [✓ 95%]  │
        │  Canada                              │
        │  Name: John Smith          [✓ 99%]  │
        │  Date Issued: 2024-03-15   [✓ 92%]  │
        │  Expiry: 2027-03-15        [✓ 90%]  │
        │  Card #: ESC-2024-08847    [✓ 88%]  │
        │                                      │
        │  [Edit]  [Re-take Photo]  [Submit]   │
        └─────────────────────────────────────┘

Step 5: Contractor reviews, corrects if needed, and submits

Step 6: Certificate record created with status: PENDING_VERIFICATION
```

### 4.2 AI Verification & Flagging

After submission, the system performs automated verification:

| Check | Description | Result |
|-------|-------------|--------|
| **Name match** | Compare extracted name against contractor's registered name | Match / Mismatch flag |
| **Expiry validation** | Check if certificate is currently valid (not expired) | Valid / Expired flag |
| **Issuing body recognition** | Compare against known/registered issuing organizations | Recognized / Unknown flag |
| **Duplicate detection** | Check if this certificate type already exists for this contractor | New / Duplicate flag |
| **Image quality** | Assess image clarity, completeness, readability | Acceptable / Poor flag |
| **OCR confidence** | Overall confidence score for extracted data | High (>85%) / Low (<85%) |

**Verification Status Flow:**

```
┌──────────────┐     AI passes     ┌──────────────┐
│   PENDING    │    all checks     │   VERIFIED   │
│ VERIFICATION │──────────────────→│   (AUTO)     │
└──────┬───────┘                   └──────────────┘
       │
       │ AI flags issue(s)
       ▼
┌──────────────┐   Contractor     ┌──────────────┐   Client Admin   ┌──────────────┐
│   FLAGGED    │   Admin reviews  │   VERIFIED   │   reviews       │   VERIFIED   │
│              │──────────────────→│  (TIER 1)    │─────────────────→│  (TIER 2)    │
└──────┬───────┘                  └──────────────┘                  └──────────────┘
       │                                │
       │                                │ Rejects
       │                                ▼
       │                          ┌──────────────┐
       │                          │   REJECTED   │
       │                          │              │
       └──────────────────────────└──────────────┘
```

**Notification Flow:**

1. **AI passes all checks** → Certificate auto-verified → Contractor notified: "Your [cert name] has been verified"
2. **AI flags an issue** → Certificate status = FLAGGED
   - **Tier 1:** Contractor Admin receives notification to review → Can verify or escalate
   - **Tier 2:** If Contractor Admin cannot resolve, Client Admin receives notification to review → Can verify or reject
3. **Rejected** → Contractor notified: "Your [cert name] was not accepted — [reason]. Please re-upload."

### 4.3 Contractor Certificate Record

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| contractor_user_id | UUID (FK) | The contractor |
| certification_definition_id | UUID (FK) | The type of certification |
| certificate_name | String | As extracted / entered |
| issuing_body | String | Issuing organization |
| certificate_number | String | Card/certificate number |
| date_issued | Date | When issued |
| date_expiry | Date | When it expires |
| image_url | String | Stored photograph (encrypted) |
| image_thumbnail_url | String | Thumbnail for display |
| extraction_data | JSON | Raw AI extraction results with confidence scores |
| verification_status | Enum | PENDING_VERIFICATION, FLAGGED, VERIFIED_AUTO, VERIFIED_TIER1, VERIFIED_TIER2, REJECTED |
| verified_by | UUID (FK) | User who verified (if manual) |
| verified_at | Timestamp | When verified |
| rejection_reason | Text | If rejected, why |
| flag_reasons | JSON Array | AI flag details |
| is_current | Boolean | Whether this is the current/active certificate for this type |
| created_at | Timestamp | Record creation |

---

## 5. Compliance Status Engine

### 5.1 Contractor Compliance Calculation

For each contractor assigned to a site, the system calculates a **Certification Compliance Status** by comparing the site's required certifications against the contractor's verified certificates.

```
Site Required Certifications = Union of all Certification Groups assigned to site
                              + any additional individual certifications

For each required certification:
  → Does contractor have a VERIFIED record for this cert type?
  → Is the certificate currently valid (not expired)?
  → Result: COMPLIANT, EXPIRING_SOON, EXPIRED, MISSING

Overall Compliance Status:
  → ALL COMPLIANT:        All certs verified and valid          → ✅ COMPLIANT
  → EXPIRING SOON:        All valid but 1+ within 3-month window → ⚠️ EXPIRING
  → NON-COMPLIANT:        1+ cert expired or missing            → 🚫 NON-COMPLIANT
```

### 5.2 Combined QR Code Verification

When a foreman scans a contractor's QR code, the status page now shows **both** orientation and certification compliance:

```
┌─────────────────────────────────────────────┐
│  CONTRACTOR VERIFICATION                     │
│                                              │
│  Name:       John Smith                      │
│  Company:    ABC Electrical Ltd.              │
│  Trade:      Electrical                       │
│                                              │
│  ────────── ORIENTATION ──────────           │
│  Site:       LNG Facility — Train 1           │
│  ┌────────────────────────────────────────┐  │
│  │  ✅  STATUS: ACTIVE                    │  │
│  │  Completed: 2026-02-15                 │  │
│  │  Expires:   2027-02-15                 │  │
│  │  Score:     92%                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ──────── CERTIFICATIONS ────────            │
│  ┌────────────────────────────────────────┐  │
│  │  ⚠️  5 of 6 VALID — 1 EXPIRED         │  │
│  │                                        │  │
│  │  ✅ H2S Alive        Exp: 2027-03-15  │  │
│  │  ✅ Standard First Aid Exp: 2027-01-20 │  │
│  │  ✅ WHMIS 2015       Exp: 2026-11-30  │  │
│  │  ✅ CSO              Exp: 2027-06-01  │  │
│  │  ✅ Confined Space   Exp: 2028-04-22  │  │
│  │  ❌ Fall Protection  EXPIRED 2026-02-10│  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [Confirm Site Entry]  [Flag Issue]          │
└─────────────────────────────────────────────┘
```

### 5.3 Daily Foreman Compliance Report

Each morning (configurable time), the system generates and pushes a **Daily Compliance Report** to each foreman for their assigned site(s):

```
┌─────────────────────────────────────────────┐
│  DAILY COMPLIANCE REPORT                     │
│  Train 1 Facility — Feb 26, 2026             │
│                                              │
│  DEFICIENCIES (3)                            │
│                                              │
│  ❌ John Smith — ABC Electrical              │
│     Fall Protection: EXPIRED Feb 10, 2026    │
│                                              │
│  ❌ Maria Garcia — XYZ Scaffolding           │
│     H2S Alive: EXPIRED Feb 20, 2026         │
│     Confined Space: MISSING                  │
│                                              │
│  ⚠️ Robert Chen — DEF Mechanical             │
│     Standard First Aid: EXPIRES Mar 15, 2026 │
│     (within 30 days)                         │
│                                              │
│  COMPLIANT (42 contractors)                  │
│  All certifications valid ✅                  │
│                                              │
└─────────────────────────────────────────────┘
```

**Report contents:**
- Contractors with EXPIRED certifications (immediate action required)
- Contractors with MISSING certifications (not yet uploaded)
- Contractors with certifications EXPIRING within 30 days (advance warning)
- Summary count of fully compliant contractors

**Delivery:**
- Push notification to foreman's mobile app
- Also available in foreman's web dashboard
- Email copy (configurable)

---

## 6. Expiry Notification System

### 6.1 Contractor Notifications

Contractors receive proactive notifications about their own certifications:

| Trigger | Channel | Message |
|---------|---------|---------|
| **3 months before expiry** | Email + SMS + Push | "Your [cert name] expires on [date]. You have 3 months to renew." |
| **30 days before expiry** | Email + SMS + Push | "Your [cert name] expires in 30 days on [date]. Please renew promptly." |
| **7 days before expiry** | Email + SMS + Push | "URGENT: Your [cert name] expires in 7 days on [date]. Renew immediately to maintain site access." |
| **Day of expiry** | Email + SMS + Push | "Your [cert name] has expired today. You are no longer compliant for sites requiring this certification." |
| **Certificate verified** | Push | "Your [cert name] has been verified ✅" |
| **Certificate rejected** | Email + Push | "Your [cert name] was not accepted. Reason: [reason]. Please re-upload." |

### 6.2 Contractor Admin Notifications

| Trigger | Channel | Message |
|---------|---------|---------|
| **Worker cert flagged** | Email + Push | "[Worker name]'s [cert name] requires your review." |
| **Worker cert expiring (30 days)** | Email | "Weekly summary: [N] workers have certifications expiring in the next 30 days." |
| **Worker cert expired** | Email + Push | "[Worker name]'s [cert name] has expired. They are non-compliant at [site names]." |

### 6.3 Client Admin Notifications

| Trigger | Channel | Message |
|---------|---------|---------|
| **Cert flagged (Tier 2 escalation)** | Email + Push | "[Worker name]'s [cert name] requires your review (escalated from Contractor Admin)." |
| **Weekly compliance summary** | Email | "Weekly compliance report: [N] compliant, [N] expiring, [N] non-compliant across all sites." |
| **Certification group updated** | Email | "The certification group [group name] was updated. [N] sites affected." |

---

## 7. Client Admin Configuration Workflow

### 7.1 Setting Up the Certification Framework

```
Step 1: Define Certification Types
        → Client Admin opens "Certification Management"
        → Adds each certification type the organization recognizes
        → Sets name, issuing bodies, validity period, category

Step 2: Create Certification Groups
        → Groups certifications into logical bundles
        → Designates one group as "Baseline — All Workers"
        → Creates hazard-specific groups (Sour Gas, Heights, Confined Space, etc.)
        → Marks groups as "master" for dynamic propagation

Step 3: Profile Each Site
        → Opens each site's configuration
        → Selects Work Types performed at site
        → Selects Hazards present at site
        → System auto-suggests Certification Groups
        → Admin reviews, adjusts, confirms

Step 4: Dynamic Linkage Active
        → Any future changes to master Certification Groups
           automatically update all linked sites
        → New certifications added to a group immediately
           become requirements at all assigned sites
```

### 7.2 Work Types & Hazard Categories

**Work Types** (contractor trade/service classification):

| Work Type | Description |
|-----------|-------------|
| Electrical | Electrical installation, maintenance, instrumentation |
| Mechanical | Mechanical equipment, rotating equipment, valves |
| Pipefitting | Pipe installation, modification, tie-ins |
| Welding | Structural and pipe welding |
| Scaffolding | Scaffold erection, inspection, dismantling |
| Insulation | Thermal insulation, fireproofing |
| Civil | Earthworks, foundations, concrete |
| Instrumentation | Control systems, measurement devices |
| General Labour | General support, cleanup, material handling |
| Heavy Equipment | Crane operation, heavy lift, rigging |
| Painting/Coating | Industrial painting, coating, blasting |
| HVAC | Heating, ventilation, air conditioning |
| Telecom/IT | Communications, networking, SCADA |

**Hazard Categories** (site hazard profile):

| Hazard | Typical Certification Required |
|--------|-------------------------------|
| H₂S Exposure | H2S Alive |
| Working at Heights | Fall Protection |
| Confined Spaces | Confined Space Entry |
| Ground Disturbance | Ground Disturbance Level II |
| Dangerous Goods Transport | TDG |
| Heavy Vehicle Operations (BC) | ODA |
| Flammable Atmospheres | Detection & Control of Flammable Substances |

---

## 8. Security Requirements

### 8.1 Certificate Image Security

Certification photographs contain personal information and must be protected:

| Requirement | Description |
|-------------|-------------|
| **Encryption at rest** | All certificate images encrypted using AES-256 |
| **Encryption in transit** | All uploads over TLS 1.3 |
| **Access control** | Certificate images viewable only by: the contractor, their contractor admin, and the client admin |
| **Foreman restriction** | Foremen see compliance status only — NOT certificate images |
| **Storage isolation** | Certificate images stored in tenant-isolated storage buckets |
| **Retention policy** | Images retained for duration of contractor's active relationship + configurable retention period |
| **Right to deletion** | Contractors can request deletion of their certificate images upon relationship termination |
| **Audit logging** | All access to certificate images logged (who viewed, when) |

### 8.2 AI Processing Security

| Requirement | Description |
|-------------|-------------|
| **Processing location** | OCR/AI processing performed within the platform's cloud region (data residency compliance) |
| **No third-party retention** | If using external AI APIs, ensure no data retention by the provider |
| **PII handling** | Extracted PII (name, certificate numbers) subject to same encryption and access controls as source images |
| **Confidence thresholds** | Low-confidence extractions flagged rather than auto-accepted to prevent data quality issues |

---

## 9. Data Model Additions

### 9.1 New Tables

| Table | Purpose |
|-------|---------|
| `certification_definitions` | Master list of certification types per organization |
| `certification_groups` | Grouped bundles of certifications |
| `certification_group_items` | Join table: which certs belong to which group |
| `site_certification_profiles` | Site-level certification requirements configuration |
| `site_certification_groups` | Join table: which groups are assigned to which sites |
| `contractor_certificates` | Individual contractor certification records with images |
| `certificate_verifications` | Verification audit trail (who verified, when, result) |
| `compliance_snapshots` | Daily compliance status snapshots for reporting |
| `expiry_notifications` | Notification log (sent, delivered, type) |
| `work_types` | Configurable work type definitions |
| `hazard_categories` | Configurable hazard category definitions |
| `hazard_certification_mapping` | Links hazard categories to required certification types |

---

## 10. Integration with Existing Modules

### 10.1 Orientation Module Integration

| Integration Point | Description |
|-------------------|-------------|
| **QR code scan** | Foreman scan now shows combined orientation + certification status |
| **Contractor dashboard** | Contractor sees both orientation progress and certification compliance in one view |
| **Contractor admin dashboard** | Worker list shows orientation status AND certification compliance side by side |
| **Client admin dashboard** | Site compliance view combines orientation completion rates and certification compliance rates |

### 10.2 Updated Compliance Status Hierarchy

A contractor's overall **Site Access Status** is now a combination:

```
Site Access Status = Orientation Status AND Certification Status

Orientation: ACTIVE  + Certifications: COMPLIANT     = ✅ CLEARED
Orientation: ACTIVE  + Certifications: EXPIRING       = ⚠️ CLEARED (WARNING)
Orientation: ACTIVE  + Certifications: NON-COMPLIANT  = 🚫 NOT CLEARED
Orientation: EXPIRED + Certifications: COMPLIANT      = 🚫 NOT CLEARED
Orientation: EXPIRED + Certifications: NON-COMPLIANT  = 🚫 NOT CLEARED
```

---

## 11. Rev 2 Enhancements (Future)

| Enhancement | Description |
|-------------|-------------|
| **Jurisdiction-aware requirements** | Sites tagged with province auto-populate jurisdiction-specific certification requirements (BC/AB/SK OHS regulation mapping) |
| **Trade-driven requirements** | Contractor service type determines additional certifications beyond site baseline (electricians need X, scaffolders need Y) |
| **Issuing body API integration** | Direct verification against issuing body databases (e.g., ESC registry) to confirm certificate authenticity |
| **Certificate renewal reminders with booking links** | Notifications include links to book renewal training with recognized providers |
| **Bulk certificate upload** | Contractor Admin uploads multiple certificates for a worker in one session |
| **Certificate sharing** | Contractor's verified certificates portable across client organizations (with contractor consent) |
| **Compliance analytics** | Trend analysis of certification compliance rates, common deficiencies, and renewal patterns |
| **Digital wallet integration** | Contractors store verified certificates in a digital wallet (Apple Wallet, Google Wallet) |
| **AI training improvement** | Feedback loop from manual verifications improves AI extraction accuracy over time |

---

## 12. Updated RBAC Model

| Role | Certs Check Permissions |
|------|------------------------|
| **Client Admin** | Define certification types, create/edit groups, profile sites, review Tier 2 flagged certs, view compliance dashboards, configure notification rules |
| **Content Developer** | No Certs Check permissions (content authoring only) |
| **Client Site Foreman** | Scan QR codes (sees combined status), view daily compliance report, flag issues |
| **Contractor Admin** | View worker certification status, review Tier 1 flagged certs, receive expiry notifications for their workers |
| **Contractor User** | Photograph and upload certificates, view own compliance status, receive expiry notifications, re-upload rejected certs |

---

*End of CertsCheck.md*
