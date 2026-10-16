import type { LayerRef, PrintOptions } from '@binder/shared'
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { shows } from './tenancy'

export type ExportKind = 'tmix' | 'pdf-script' | 'pdf-sheet' | 'csv' | 'xlsx'

/**
 * One row per export (spec 5.3, 7). The file lives in the blob store under `file_key`. `private_to`
 * is the exporting user's id when the selection includes their personal layer: such a record, and
 * its file, are visible to that user only (the sync streams, the services and the blob route all
 * enforce it). `snapshot_id`, `binder_version` and `changelog` are filled by snapshots in M2.
 */
export const exportRecords = pgTable(
  'export_records',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ExportKind>().notNull(),
    filename: text('filename').notNull(),
    castVariantId: text('cast_variant_id'),
    layerSelection: jsonb('layer_selection').$type<LayerRef[]>().notNull(),
    snapshotId: text('snapshot_id'),
    binderVersion: integer('binder_version'),
    privateTo: text('private_to'),
    fileKey: text('file_key').notNull(),
    changelog: jsonb('changelog').$type<unknown>(),
    /** What a script print chose beyond the layers (pages, paper, includes); null for older records and non-script files. */
    options: jsonb('options').$type<PrintOptions>(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [index('export_records_show_idx').on(t.showId)],
)
