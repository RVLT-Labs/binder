import type { DocumentKind, FailureCode, OcrMode, PageStatus, VersionStatus } from '@binder/shared'
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { shows } from './tenancy'

export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<DocumentKind>().notNull(),
    title: text('title').notNull(),
    // No FK: documents and document_versions reference each other.
    currentVersionId: text('current_version_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    ocrMode: text('ocr_mode').$type<OcrMode>().notNull().default('auto'),
    snapToText: boolean('snap_to_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [index('documents_show_idx').on(t.showId)],
)

export const documentVersions = pgTable(
  'document_versions',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    label: text('label'),
    originalKey: text('original_key').notNull(),
    searchableKey: text('searchable_key'),
    pageCount: integer('page_count'),
    uploadedBy: text('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').$type<VersionStatus>().notNull().default('queued'),
    error: text('error'),
    // Bytes of the uploaded original; null for versions uploaded before it was captured.
    originalSizeBytes: integer('original_size_bytes'),
    // Set only when status is 'failed'. `error` keeps the technical detail.
    failureCode: text('failure_code').$type<FailureCode>(),
    // Median scan resolution; set only for failure_code 'low_resolution'.
    failureDpi: integer('failure_dpi'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Rows written by processing jobs use 'system'.
    updatedBy: text('updated_by').notNull().default('system'),
  },
  (t) => [
    unique('document_versions_document_number_unique').on(t.documentId, t.versionNumber),
    index('document_versions_show_idx').on(t.showId),
  ],
)

export const pages = pgTable(
  'pages',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    documentVersionId: text('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    // Displayed page space: PDF points, after /Rotate. Unknown until the page job has run.
    width: real('width'),
    height: real('height'),
    rotation: integer('rotation'),
    thumbKey: text('thumb_key'),
    wordsKey: text('words_key'),
    ocrApplied: boolean('ocr_applied').notNull().default(false),
    status: text('status').$type<PageStatus>().notNull().default('queued'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Rows written by processing jobs use 'system'.
    updatedBy: text('updated_by').notNull().default('system'),
  },
  (t) => [
    unique('pages_version_index_unique').on(t.documentVersionId, t.index),
    index('pages_show_idx').on(t.showId),
  ],
)
