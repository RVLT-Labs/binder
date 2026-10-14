import type { Role, ShowStatus } from '@binder/shared'
import { sql } from 'drizzle-orm'
import { jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const organisations = pgTable('organisations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgMemberships = pgTable(
  'org_memberships',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role').$type<'owner' | 'member'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('org_memberships_org_user_unique').on(t.organisationId, t.userId)],
)

export const shows = pgTable('shows', {
  id: text('id').primaryKey(),
  organisationId: text('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').$type<ShowStatus>().notNull().default('prep'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  // No FK: Better Auth's user table arrives in a later task.
  updatedBy: text('updated_by').notNull(),
})

export const showMemberships = pgTable(
  'show_memberships',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role').$type<Role>().notNull(),
    departments: jsonb('departments').$type<string[]>().notNull().default(['*']),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('show_memberships_show_user_unique').on(t.showId, t.userId)],
)

export const personalAccessTokens = pgTable('personal_access_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  /** Either "*" (every show the user can reach) or a list of show ids. */
  showScope: jsonb('show_scope').$type<'*' | string[]>().notNull().default(sql`'"*"'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})
