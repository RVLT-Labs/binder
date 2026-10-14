import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Chunks of sync uploads already applied, keyed by the logged batch id (`<userId>:<clientBatchId>`)
 * and the chunk index. Inserted in the same transaction as the chunk's writes, so a retried chunk is
 * recognised and skipped instead of re-applying its PATCHes over newer edits. Server-only: never
 * synced, never in the `powersync` publication. Rows older than seven days are deleted daily.
 * `digest` is the SHA-256 of the chunk's entries as canonical JSON: a key seen again with other
 * entries (the same transaction re-chunked) is not a replay.
 */
export const syncAppliedChunks = pgTable(
  'sync_applied_chunks',
  {
    batchKey: text('batch_key').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    digest: text('digest').notNull().default(''),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.batchKey, t.chunkIndex] })],
)
