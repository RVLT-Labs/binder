import type { Via } from '@binder/shared'
import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const changeLog = pgTable(
  'change_log',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    // No FKs: the log records what happened and must outlive the rows it describes.
    showId: text('show_id').notNull(),
    userId: text('user_id').notNull(),
    via: text('via').$type<Via>().notNull(),
    agent: text('agent'),
    clientTs: timestamp('client_ts', { withTimezone: true }),
    serverTs: timestamp('server_ts', { withTimezone: true }).notNull().defaultNow(),
    batchId: text('batch_id'),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    /** A layerKey (`department:<id>`, `personal:<userId>`), or null for rows outside layers. */
    layer: text('layer'),
    op: text('op').$type<'insert' | 'update' | 'delete'>().notNull(),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
  },
  (t) => [
    index('change_log_show_seq_idx').on(t.showId, t.seq),
    index('change_log_show_row_seq_idx').on(t.showId, t.rowId, t.seq),
  ],
)
