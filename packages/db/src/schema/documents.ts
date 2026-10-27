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

/**
 * A PDF upload negotiated over MCP (begin, PUT the bytes, complete). Server-only: never in the
 * PowerSync publication, so neither hash leaves the API. The staged bytes live at `staging_key` until
 * the upload completes, is cancelled or expires; `expires_at` drives the sweep.
 */
export const documentUploads = pgTable(
  'document_uploads',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    // The user who began it; only they can complete or cancel it.
    userId: text('user_id').notNull(),
    mode: text('mode').$type<'new_document' | 'new_version'>().notNull(),
    // new_version only. No FK: a removed document fails the completion instead of the row vanishing.
    documentId: text('document_id'),
    kind: text('kind').$type<DocumentKind>(),
    title: text('title'),
    ocrMode: text('ocr_mode').$type<OcrMode>(),
    label: text('label'),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    // SHA-256 of the one-time upload secret; the secret itself is never stored.
    secretHash: text('secret_hash').notNull(),
    status: text('status')
      .$type<'pending' | 'receiving' | 'received' | 'completing' | 'completed'>()
      .notNull()
      .default('pending'),
    // PUTs that began, failed ones included; capped.
    attempts: integer('attempts').notNull().default(0),
    stagingKey: text('staging_key').notNull(),
    resultDocumentId: text('result_document_id'),
    resultVersionId: text('result_version_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('document_uploads_user_idx').on(t.userId, t.status),
    index('document_uploads_expires_idx').on(t.expiresAt),
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
