import { column, Schema, Table } from '@powersync/web'

// Mirrors packages/db/src/schema (Postgres). SQLite encodings: uuid, jsonb and timestamps are text;
// booleans and integers are integer; page dimensions are real. PowerSync adds `id` itself.

const shows = new Table({
  organisation_id: column.text,
  title: column.text,
  status: column.text,
  settings: column.text,
  created_at: column.text,
  updated_at: column.text,
  updated_by: column.text,
})

const show_memberships = new Table(
  {
    show_id: column.text,
    user_id: column.text,
    role: column.text,
    departments: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
  },
  { indexes: { show: ['show_id'] } },
)

const documents = new Table(
  {
    show_id: column.text,
    kind: column.text,
    title: column.text,
    current_version_id: column.text,
    sort_order: column.integer,
    ocr_mode: column.text,
    snap_to_text: column.integer,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
  },
  { indexes: { show: ['show_id'] } },
)

const document_versions = new Table(
  {
    show_id: column.text,
    document_id: column.text,
    version_number: column.integer,
    label: column.text,
    original_key: column.text,
    searchable_key: column.text,
    page_count: column.integer,
    uploaded_by: column.text,
    uploaded_at: column.text,
    status: column.text,
    error: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
  },
  { indexes: { document: ['document_id'] } },
)

const pages = new Table(
  {
    show_id: column.text,
    document_version_id: column.text,
    index: column.integer,
    width: column.real,
    height: column.real,
    rotation: column.integer,
    thumb_key: column.text,
    words_key: column.text,
    ocr_applied: column.integer,
    status: column.text,
    error: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
  },
  { indexes: { version: ['document_version_id', 'index'] } },
)

export const AppSchema = new Schema({
  shows,
  show_memberships,
  documents,
  document_versions,
  pages,
})

export type Database = (typeof AppSchema)['types']
export type ShowRow = Database['shows']
