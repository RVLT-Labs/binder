import type { Anchor, AnnotationType, CueType, LayerKind, NumberFormat } from '@binder/shared'
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

/**
 * Marks on a page. `layer_id` is a department id or, for a personal layer, the owner's user id (so
 * it has no foreign key). Geometry is relative to the anchor, in points. Personal rows are visible
 * only to their owner: the sync streams, the services and the change log all enforce it.
 */
export const annotations = pgTable(
  'annotations',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    layerKind: text('layer_kind').$type<LayerKind>().notNull(),
    layerId: text('layer_id').notNull(),
    // One atomic value, so concurrent moves cannot interleave x and y.
    anchor: jsonb('anchor').$type<Anchor>().notNull(),
    type: text('type').$type<AnnotationType>().notNull(),
    geometry: jsonb('geometry').$type<Record<string, number>>().notNull().default({}),
    text: text('text').notNull().default(''),
    style: jsonb('style').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    index('annotations_show_idx').on(t.showId),
    index('annotations_layer_idx').on(t.layerKind, t.layerId),
    index('annotations_anchor_version_idx').on(sql`(${t.anchor}->>'documentVersionId')`),
  ],
)
