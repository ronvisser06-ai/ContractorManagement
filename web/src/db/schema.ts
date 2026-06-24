import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { customType } from 'drizzle-orm/pg-core'
import type { JobStatus } from '@/contracts/types'

// citext is case-insensitive text; the extension is enabled in the migration
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext'
  },
})

// ── Enums ─────────────────────────────────────────────────────────────────────

export const userStatusEnum = pgEnum('user_status', ['active', 'disabled'])

export const orgStatusEnum = pgEnum('org_status', ['active', 'suspended'])

// Roles are additive; a user may hold more than one in an org
export const orgRoleEnum = pgEnum('org_role', [
  'client_admin',
  'content_developer',
  'content_approver',
  'foreman',
])

export const membershipStatusEnum = pgEnum('membership_status', [
  'invited',
  'active',
  'disabled',
])

// orientation_pipeline_contracts_v0.1.md §4.6
export const requalificationPolicyEnum = pgEnum('requalification_policy', [
  'full',
  'new_content_only',
  'none',
])

export const orientationPackageStatusEnum = pgEnum('orientation_package_status', [
  'published',
  'archived',
])

// Generation pipeline job state machine (orientation_pipeline_contracts_v0.1.md §1).
// current_stage shares this enum so a failed/cancelled job still records which
// working stage it was in (needed to re-enter on retry).
// `satisfies` pins every value to the contract's JobStatus union so this enum
// can't silently drift from src/contracts/types.ts.
export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'extracting',
  'structuring',
  'generating_quiz',
  'qa_review',
  'awaiting_approval',
  'publishing',
  'published',
  'failed',
  'cancelled',
] satisfies readonly [JobStatus, ...JobStatus[]])

// ── Tables ────────────────────────────────────────────────────────────────────

// Identity (contractor domain + shared)
// id = Supabase auth.uid() — set by the signup handler, never generated here
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  givenName: text('given_name').notNull(),
  familyName: text('family_name').notNull(),
  primaryEmail: citext('primary_email').notNull(),
  mobile: text('mobile'),
  status: userStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Client domain — tenant root
// id is a prefixed ULID: org_<ULID>, generated in application code via newId('org_')
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: orgStatusEnum('status').notNull().default('active'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Client domain — scoped to an org
// active_package_id is null until M2 (generation pipeline)
export const sites = pgTable('sites', {
  id: text('id').primaryKey(), // prefixed ULID: site_<ULID>
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  address: jsonb('address'),
  province: text('province'),
  orientationValidityMonths: integer('orientation_validity_months'),
  activePackageId: text('active_package_id'), // FK orientation_packages; null until M2
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Client domain — user membership in an org with one or more roles
export const orgMemberships = pgTable(
  'org_memberships',
  {
    id: text('id').primaryKey(), // prefixed ULID
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    roles: orgRoleEnum('roles').array().notNull().default([]),
    status: membershipStatusEnum('status').notNull().default('invited'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.orgId)],
)

// Client domain — one row per generation run (orientation_pipeline_contracts_v0.1.md §2).
// Flat columns per HowDesign-DataModel.md §3.2; large stage outputs live in jsonb,
// never inline payloads — the job row only ever holds a storage key + sha256.
export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(), // prefixed ULID: job_<ULID>
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    status: jobStatusEnum('status').notNull().default('queued'),
    currentStage: jobStatusEnum('current_stage').notNull().default('queued'),
    reworkCount: integer('rework_count').notNull().default(0),
    maxRework: integer('max_rework').notNull().default(3),
    qaFlagged: boolean('qa_flagged').notNull().default(false),
    packageId: text('package_id'), // FK orientation_packages, set on publish (Step 5)
    packageVersion: integer('package_version'), // set alongside package_id on publish
    // Step 3: the uploaded deck (contracts §2 SourceAsset). Nullable at the column
    // level only so existing rows from Steps 1-2 testing don't break; every job
    // created going forward populates it at insert time.
    sourceAsset: jsonb('source_asset'),
    artifacts: jsonb('artifacts').notNull().default({}),
    qaHistory: jsonb('qa_history').notNull().default([]),
    telemetry: jsonb('telemetry').notNull().default({}),
    error: jsonb('error'),
    // Step 5: set by the approve action on the awaiting_approval -> publishing
    // transition (contracts §1).
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').notNull(),
  },
  (t) => [unique().on(t.idempotencyKey)],
)

// Client domain — immutable published artifact of the generation pipeline
// (orientation_pipeline_contracts_v0.1.md §4.6 for the canonical shape;
// HowDesign-DataModel.md §3.2 for platform-side columns). Never updated after
// insert — a content edit produces a new version, never a mutation in place.
export const orientationPackages = pgTable(
  'orientation_packages',
  {
    id: text('id').primaryKey(), // prefixed ULID: pkg_<ULID>
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    version: integer('version').notNull(),
    supersedesId: text('supersedes_id'), // FK orientation_packages.id; self-ref, nullable
    contentModelRef: jsonb('content_model_ref').notNull(), // ArtifactRef {storage_key, sha256}
    quizRef: jsonb('quiz_ref').notNull(), // ArtifactRef {storage_key, sha256}
    assetManifest: jsonb('asset_manifest').notNull().default([]),
    contentHash: text('content_hash').notNull(), // completions pin to this
    requalificationPolicy: requalificationPolicyEnum('requalification_policy').notNull(),
    qaFlagged: boolean('qa_flagged').notNull().default(false),
    status: orientationPackageStatusEnum('status').notNull().default('published'),
    approvedBy: uuid('approved_by')
      .notNull()
      .references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.siteId, t.version)],
)
