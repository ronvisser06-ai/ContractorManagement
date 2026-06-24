# Contractor Orientation Management Solution — Development Plan

## Document Information

| Field | Value |
|-------|-------|
| **Document** | DevelopmentPlan.md |
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Last Updated** | 2026-02-26 |

---

## 1. Executive Summary

The Contractor Orientation Management Solution is a multi-tenant web application that enables industrial clients (asset owners/operators) to manage site-specific contractor orientations, assessments, and on-site compliance verification through QR-code-based scanning. The platform serves four distinct user roles — Client Admin, Client Site Foreman, Contractor Admin, and Contractor User — and delivers a complete workflow from contractor company onboarding through orientation completion, assessment scoring, and real-time site-access verification.

The solution targets oil & gas, LNG, mining, energy, construction, and industrial operations where contractor site orientation is a regulatory and operational requirement.

---

## 2. Solution Overview

### 2.1 Problem Statement

Industrial sites require contractors to complete site-specific orientations before gaining site access. Current approaches rely on paper sign-off sheets, manual tracking spreadsheets, and in-person orientation sessions that are difficult to schedule, track, and verify. This creates compliance gaps, audit exposure, and operational delays when contractors arrive on site without verified orientation completion.

### 2.2 Solution Description

A web-based platform where:

- **Clients** create and manage site-specific orientation content and quizzes
- **Contractor companies** are invited by clients, register their workforce, and manage employee orientation completion
- **Individual contractors** complete orientations online, pass assessments, and receive a static QR code via email as proof of completion
- **Site foremen** scan QR codes on-site to instantly verify a contractor's orientation status, completion dates, and expiration dates

### 2.3 Key Differentiators

- **QR-code verification** — low-friction, no mobile app required for contractors; email-based delivery
- **Multi-site, multi-client architecture** — one contractor can complete orientations for multiple sites across multiple clients
- **Progressive onboarding states** — contractor user lifecycle tracking from Entered → Invited → Logged In → Account Created
- **Site-specific content** — each site has its own orientation and quiz, managed by the client admin
- **Lightweight CRM** — contractor company profiles with trade/work-type classification and employee management
- **Real-time compliance dashboard** — foremen and admins see live orientation status across their workforce

---

## 3. User Roles & Permissions

### 3.1 Role Hierarchy

| Role | Description | Key Capabilities |
|------|-------------|------------------|
| **Client Admin** | Site owner/operator administrator | Create sites, upload orientations, manage contractor companies, invite contractors, view dashboards, manage foremen, assign orientations to sites |
| **Content Developer** | Orientation content author | Create/edit/publish orientation packages, upload PowerPoints, build quizzes, preview in Test User mode, view analytics, export/import JSON |
| **Client Site Foreman** | On-site supervisor | Scan QR codes, verify contractor status, view completion/expiry for their assigned site(s) |
| **Contractor Admin** | Contractor company administrator | Create company profile, add employees/subcontractors, invite workers, track their orientation progress |
| **Contractor User** | Individual contractor/worker | Create account, complete orientations, take quizzes, receive QR code, present QR code on site |

### 3.2 Permission Matrix

| Action | Client Admin | Foreman | Contractor Admin | Contractor User |
|--------|:---:|:---:|:---:|:---:|
| Create/manage sites | ✅ | ❌ | ❌ | ❌ |
| Upload orientation content | ✅ | ❌ | ❌ | ❌ |
| Create/manage quizzes | ✅ | ❌ | ❌ | ❌ |
| Invite contractor companies | ✅ | ❌ | ❌ | ❌ |
| View all contractor statuses | ✅ | ✅ (own site) | ✅ (own workers) | ❌ |
| Scan QR codes | ❌ | ✅ | ❌ | ❌ |
| Manage company profile | ❌ | ❌ | ✅ | ❌ |
| Add/invite employees | ❌ | ❌ | ✅ | ❌ |
| Complete orientation | ❌ | ❌ | ❌ | ✅ |
| Take quiz | ❌ | ❌ | ❌ | ✅ |
| Receive QR code | ❌ | ❌ | ❌ | ✅ |
| Revoke/expire access | ✅ | ❌ | ❌ | ❌ |

---

## 4. Technical Architecture

### 4.1 Recommended Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend** | Next.js 14+ (App Router) with TypeScript | SSR/SSG, React ecosystem, proven at scale |
| **UI Framework** | Tailwind CSS + shadcn/ui | Rapid professional UI, accessible components |
| **Authentication** | Firebase Authentication or Clerk | Email/password, SSO-ready, MFA support |
| **Database** | PostgreSQL (Supabase or Neon) | Relational integrity, Row-Level Security, multi-tenant |
| **ORM** | Prisma or Drizzle ORM | Type-safe database access |
| **File Storage** | Firebase Storage or AWS S3 | Orientation content (videos, PDFs, images) |
| **QR Code Generation** | `qrcode` npm package | Static QR codes linking to contractor status page |
| **Email Service** | SendGrid or Resend | Transactional emails (invitations, QR code delivery) |
| **Hosting** | Vercel or Google Cloud Platform | Edge deployment, auto-scaling |
| **Mobile Scanning** | Progressive Web App (camera API) | Foreman QR scanning without native app |

### 4.2 Multi-Tenant Architecture

The platform uses a **shared database, schema-isolated** multi-tenant model:

- Each client organization is a tenant
- All data is scoped by `clientId` (tenant identifier)
- Row-Level Security (RLS) enforces data isolation
- Contractor companies and users can exist across multiple tenants (a contractor may work for multiple clients)
- Cross-tenant contractor data is shared only where the contractor has accepted invitations

### 4.3 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT BROWSER                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │Client    │ │Foreman   │ │Contractor│ │Contractor  │ │
│  │Admin     │ │Scanner   │ │Admin     │ │User Portal │ │
│  │Dashboard │ │PWA       │ │Portal    │ │(Training)  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ │
└───────┼─────────────┼───────────┼──────────────┼────────┘
        │             │           │              │
        ▼             ▼           ▼              ▼
┌─────────────────────────────────────────────────────────┐
│                   NEXT.JS API ROUTES                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │Auth      │ │Site/     │ │Contractor│ │Orientation │ │
│  │Middleware │ │Tenant    │ │Mgmt API  │ │& Quiz API  │ │
│  │          │ │API       │ │          │ │            │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│  │QR Code   │ │Email     │ │File      │               │
│  │Service   │ │Service   │ │Upload    │               │
│  └──────────┘ └──────────┘ └──────────┘               │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                     DATA LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ PostgreSQL   │  │ File Storage │  │ Email Service │ │
│  │ (Multi-      │  │ (S3/Firebase)│  │ (SendGrid/   │ │
│  │  tenant RLS) │  │              │  │  Resend)     │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Data Model Overview

### 5.1 Core Entities

```
Organizations (Clients/Tenants)
├── Sites
│   ├── Orientations
│   │   ├── OrientationContent (modules, videos, docs)
│   │   └── Quizzes
│   │       └── QuizQuestions
│   └── SiteForemen (assignments)
├── ContractorCompanyInvitations
└── Users (Client Admin, Foremen)

ContractorCompanies
├── CompanyProfile (trade types, contact info)
├── ContractorUsers
│   ├── OrientationCompletions
│   │   ├── QuizAttempts
│   │   │   └── QuizAnswers
│   │   └── QRCodes
│   └── UserStatus (Entered → Invited → Logged In → Account Created)
└── ClientRelationships (many-to-many with Organizations)
```

### 5.2 Key Tables

| Table | Purpose |
|-------|---------|
| `organizations` | Client tenants (companies that own sites) |
| `sites` | Physical work sites belonging to an organization |
| `orientations` | Site-specific orientation definitions |
| `orientation_content` | Training modules, videos, documents per orientation |
| `quizzes` | Assessment definitions tied to orientations |
| `quiz_questions` | Individual questions with answers and scoring |
| `contractor_companies` | Contractor company profiles and metadata |
| `contractor_users` | Individual contractor workers |
| `contractor_user_status` | Lifecycle state tracking (Entered/Invited/LoggedIn/AccountCreated) |
| `orientation_completions` | Completion records linking contractor to orientation |
| `quiz_attempts` | Individual quiz submissions with scores |
| `qr_codes` | Generated QR codes per contractor per site per client |
| `qr_scans` | Audit log of foreman QR code scans |
| `invitations` | Invitation records (company and individual) |

---

## 6. Development Phases

### Phase 1: Foundation & Authentication (Weeks 1–2)

**Objective:** Core platform infrastructure, authentication, and tenant setup.

**Deliverables:**
- Next.js project scaffolding with TypeScript
- Authentication system (email/password registration, login, password rules)
- Database schema and migrations (core tables)
- Multi-tenant middleware and RLS policies
- Role-based access control (RBAC) middleware
- Client Admin: create organization, create sites
- Basic UI layout (navigation, dashboard shells)

**Acceptance Criteria:**
- Users can register, login, and access role-appropriate views
- Client Admin can create an organization and add sites
- Tenant isolation verified (no cross-tenant data leakage)

---

### Phase 2: Contractor Company Management & CRM (Weeks 3–4)

**Objective:** Client invites contractor companies; contractor admins set up profiles and register workers.

**Deliverables:**
- Client Admin: invite contractor companies (email invitation)
- Contractor Admin: accept invitation, create company profile
- Company profile: trade/work type selection, contact info, logo
- Contractor Admin: add employees (first name, last name, email, mobile)
- Employee status tracking: Entered → Invited → Logged In → Account Created
- Contractor Admin: send invitations to employees (email with registration link)
- Contractor User: receive invitation, register account
- CRM dashboard for contractor admin (employee list, status overview)
- Client Admin: view contractor companies and their workers

**Acceptance Criteria:**
- Full invitation → registration flow for contractor companies
- Full invitation → registration flow for individual contractors
- Status progression tracked and visible to contractor admin and client admin
- Contractor company profile with trade type selection

---

### Phase 3: Orientation Content Builder (Weeks 5–8)

**Objective:** Web-based drag-and-drop content authoring tool for creating orientation packages.

**Deliverables:**
- Content Developer role and RBAC permissions
- Builder interface: three-panel layout (component menu, canvas, properties panel)
- Component library: Text Box, Image + Text, Image Only, Video Embed, Section Divider, PDF Viewer, Page Break, Section Header, Instruction Block
- PowerPoint upload and extraction: slide-to-image conversion + text extraction per slide
- Filmstrip view of extracted slides with drag-to-reorder and delete
- Insert components between extracted slides
- Question components (Rev 1): True/False, Multiple Choice, Select All That Apply
- Inline question placement (within content) and end-of-module quiz section
- Question randomization and answer option randomization
- Scoring configuration: passing threshold, max attempts, immediate feedback, explanations
- Running score display: Correct X / Answered Y
- Page-by-page navigation with forward and backward controls
- Preview / Test User mode for Content Developer
- Auto-save and manual save
- Undo/redo (20 levels)

**Acceptance Criteria:**
- Content Developer can build a complete orientation with sections, slides, text, images, and questions
- PowerPoint uploads extract slides as images and text
- Questions are scoreable with configurable pass/fail threshold
- Test User mode allows full walkthrough of the orientation experience
- Builder saves work automatically

---

### Phase 4: Orientation Library, Assignment & Contractor Experience (Weeks 9–11)

**Objective:** Orientation Library with versioning, site assignment, and the contractor-facing orientation experience.

**Deliverables:**
- Orientation Library: list all packages with status, version, assigned sites, statistics
- Versioning: new versions on edit; old versions retained with completion records
- Template system: save as template, duplicate to create new packages
- Export/Import: JSON export with media bundle; JSON import to create draft
- Site assignment: assign one package to one or more sites; replace existing assignments
- Contractor orientation experience: page-by-page modal with content rendering
- Video playback with optional required-viewing enforcement
- PDF in-browser viewer
- Inline question rendering with immediate feedback
- End-of-module quiz with question randomization
- Score calculation: combined inline + end-quiz scoring
- Pass/fail determination with results screen
- QR code generation upon passing
- QR code delivery via email
- Retry logic for failed attempts
- Completion records with version tracking

**Acceptance Criteria:**
- Content Developer can publish, version, template, duplicate, and export orientation packages
- Packages assignable to one or multiple sites
- Contractor can complete full orientation → inline questions → end quiz → receive QR code
- Failed contractors can retake within configured attempt limits
- Completion records tied to specific orientation version

---

### Phase 5: QR Code Verification & Foreman Experience (Weeks 12–13)

**Objective:** Foremen scan QR codes on-site to verify contractor compliance.

**Deliverables:**
- Foreman PWA: QR code scanner using device camera
- Scan result display: contractor name, company, orientation status, completion date, expiration date
- Status indicators: Active (green), Expired (amber), Revoked (red), Not Found
- Scan audit log: record every scan (who, when, where, result)
- Foreman dashboard: view all contractors expected on site, filter by status
- Client Admin: revoke contractor access (changes QR scan result to Revoked)
- Expiration logic: orientations expire based on client-configured duration
- Expired/revoked notification on scan

**Acceptance Criteria:**
- Foreman can scan QR code and see contractor status within 2 seconds
- Expired orientations show appropriate warning
- Revoked access shows revoked status on scan
- All scans logged with timestamp and foreman identity

---

### Phase 6: Dashboards, Analytics, Reporting & Polish (Weeks 14–16)

**Objective:** Management dashboards, content analytics, compliance reporting, and production readiness.

**Deliverables:**
- Client Admin dashboard: orientation completion rates by site, by contractor company
- Content Developer analytics: question-level pass/fail rates, score distributions, average completion time, drop-off analysis
- Compliance reporting: contractors approaching expiration, overdue orientations
- Contractor Admin dashboard: employee orientation status overview
- Export capabilities (CSV, PDF reports)
- Email notifications: expiration warnings (30, 14, 7 days before)
- Email notifications: completion confirmations
- UI/UX polish and responsive design
- Error handling and edge cases
- Performance optimization (lazy loading, caching)

**Acceptance Criteria:**
- Dashboards load within 3 seconds
- Expiration notifications sent on schedule
- Reports exportable in CSV and PDF formats
- Application fully responsive (desktop, tablet, mobile)

---

### Phase 7: Production Deployment & Hardening (Weeks 17–18)

**Objective:** Production-ready deployment with security and monitoring.

**Deliverables:**
- Production environment setup (GCP or Vercel)
- SSL/TLS configuration
- Database backup automation
- Application monitoring and error tracking (Sentry or similar)
- Rate limiting and abuse prevention
- Security audit (OWASP top 10 review)
- Load testing
- Documentation (admin guide, user guide)
- Beta testing with pilot client

**Acceptance Criteria:**
- Application deployed to production with 99.9% uptime target
- Backup and recovery tested
- Monitoring alerts configured
- Pilot client onboarded and providing feedback

---

## 7. Future Enhancements (Post-MVP)

| Enhancement | Description | Priority |
|-------------|-------------|----------|
| **Mobile Application (PWA → Native)** | Purpose-built mobile app for contractors (certificate photography, push notifications, QR codes) and foremen (QR scanning, daily compliance lists, offline capability) | **Critical** |
| **Certs Check Module** | Certification & licensing compliance — AI-powered certificate capture, verification matrices, dynamic certification groups, combined QR verification (orientation + certs), daily foreman deficiency reports, automated expiry notifications | **Critical** |
| **Rev 2 Question Types** | Matching, fill-in-the-blank, image hotspot, ordering/sequencing | High |
| **AI Quiz Generation** | Auto-generate questions from extracted PowerPoint text using LLM | High |
| **Jurisdiction-Aware Cert Requirements** | Sites tagged with province auto-populate jurisdiction-specific certification requirements (BC/AB/SK OHS mapping) | High |
| **Trade-Driven Cert Requirements** | Contractor service type determines additional certifications beyond site baseline | High |
| **Multi-language support** | Orientation content and UI in multiple languages | High |
| **Issuing Body API Integration** | Direct verification against ESC and other provider databases to confirm certificate authenticity | Medium |
| **Dynamic QR codes** | QR codes that change/expire independently | Medium |
| **Video completion tracking** | Ensure contractors watch full videos (not skip) | High |
| **Geofencing** | Restrict orientation completion to specific locations | Low |
| **Integration APIs** | Connect with client HR, LMS, and access control systems | High |
| **Badge/access card printing** | Generate physical badges from QR completion data | Medium |
| **Offline scanning** | Allow foremen to scan QR codes without internet (React Native) | Medium |
| **Bulk import** | CSV/Excel import of contractor employees | High |
| **SSO integration** | SAML/OIDC for enterprise clients | Medium |
| **Audit trail export** | Compliance audit package generation | High |
| **Digital wallet integration** | Contractors store verified certificates in Apple Wallet / Google Wallet | Low |
| **SCORM/xAPI export** | Export orientations in standard eLearning formats | Low |

---

## 8. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Contractor registration → completion time | < 48 hours | Average time from invitation to first orientation completion |
| QR code scan verification time | < 2 seconds | Time from scan to status display |
| Orientation completion rate | > 90% | Percentage of invited contractors who complete required orientations |
| System uptime | 99.9% | Monthly availability |
| Foreman adoption | > 80% | Percentage of site verifications done via QR scan vs. manual |
| Client onboarding time | < 1 week | Time from contract to first orientation published |

---

## 9. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Contractors lack email access | High | Medium | Allow contractor admin to print QR codes on behalf of workers |
| Poor mobile connectivity on remote sites | High | High | PWA with offline scanning capability (Phase 7+) |
| Client resistance to digital adoption | Medium | Medium | Provide training materials and onboarding support |
| QR code sharing/fraud | Medium | Low | Link QR to contractor photo; foreman visual verification |
| Content storage costs at scale | Medium | Medium | Implement video compression and CDN delivery |
| Multi-client contractor data conflicts | Medium | Low | Separate QR codes per client relationship |

---

## 10. Assumptions & Constraints

### Assumptions
- Contractors have access to email and a device capable of web browsing
- Client admins will create and maintain orientation content
- Internet connectivity is available for orientation completion (not on-site requirement)
- Foremen have a smartphone or tablet with camera and internet access on-site

### Constraints
- No native mobile app for MVP (PWA approach)
- Orientation content limited to video, PDF, images, and text for MVP
- Single language per orientation for MVP (multi-language in future phase)
- QR codes are static (link to status page) not dynamic for MVP

---

*End of DevelopmentPlan.md*
