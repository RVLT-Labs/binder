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

const departments = new Table(
  {
    show_id: column.text,
    code: column.text,
    name: column.text,
    colour: column.text,
    number_format: column.text,
    sort_order: column.integer,
    hidden: column.integer,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
  },
  { indexes: { show: ['show_id'] } },
)

const cues = new Table(
  {
    show_id: column.text,
    department_id: column.text,
    major: column.integer,
    minor: column.integer,
    label: column.text,
    anchor: column.text,
    type: column.text,
    notes: column.text,
    colour: column.text,
    payload: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
  },
  { indexes: { show: ['show_id'], department: ['department_id'] } },
)

const annotations = new Table(
  {
    show_id: column.text,
    layer_kind: column.text,
    layer_id: column.text,
    anchor: column.text,
    type: column.text,
    geometry: column.text,
    text: column.text,
    style: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
  },
  { indexes: { show: ['show_id'], layer: ['layer_kind', 'layer_id'] } },
)

export const AppSchema = new Schema({
  shows,
  show_memberships,
  documents,
  document_versions,
  pages,
  departments,
  cues,
  annotations,
})

export type Database = (typeof AppSchema)['types']
export type ShowRow = Database['shows']
export type DocumentRow = Database['documents']
export type DocumentVersionRow = Database['document_versions']
export type PageRow = Database['pages']
export type DepartmentRow = Database['departments']
export type CueRow = Database['cues']
export type AnnotationRow = Database['annotations']
