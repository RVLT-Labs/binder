import type { NumberFormat } from '@binder/shared'
import { boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
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
