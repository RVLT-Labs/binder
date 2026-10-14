import type { Anchor, CueType, NumberFormat } from '@binder/shared'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { shows } from './tenancy'

export const departments = pgTable(
  'departments',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    colour: text('colour').notNull(),
    numberFormat: text('number_format').$type<NumberFormat>().notNull().default('decimal'),
    sortOrder: integer('sort_order').notNull().default(0),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    unique('departments_show_code_unique').on(t.showId, t.code),
    index('departments_show_idx').on(t.showId),
  ],
)

export const cues = pgTable(
  'cues',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    // RESTRICT: departments are hidden, never deleted, and a department with cues cannot go away.
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    major: integer('major').notNull(),
    minor: integer('minor').notNull().default(0),
    label: text('label').notNull().default(''),
    // Null means unplaced. One atomic value, so concurrent moves cannot interleave x and y.
    anchor: jsonb('anchor').$type<Anchor | null>(),
    type: text('type').$type<CueType>().notNull().default('go'),
    notes: text('notes').notNull().default(''),
    colour: text('colour'),
    // Other departments' payloads; not writable in M1.
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    check('cues_number_range', sql`${t.minor} between 0 and 99 and ${t.major} >= 0`),
    index('cues_show_idx').on(t.showId),
    index('cues_department_idx').on(t.departmentId),
    index('cues_anchor_version_idx').on(sql`(${t.anchor}->>'documentVersionId')`),
  ],
)
