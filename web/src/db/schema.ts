import {
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
