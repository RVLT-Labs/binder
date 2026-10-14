import { cueFieldsSchema, type SyncCrudEntry } from '@binder/shared'
import { expect, test } from 'vitest'
import { toUploadChunks, UPLOAD_CHUNK_MAX, UPLOAD_CHUNK_MAX_BYTES } from './uploadChunks'

/** The API's JSON body limit (apps/api/src/app.ts MAX_JSON_BODY_BYTES): a request above it is 413. */
const SERVER_BODY_LIMIT = 2 * 1024 * 1024

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/** The largest body the connector can send for these entries: the longest batch id and chunk numbers. */
const body = (entries: SyncCrudEntry[]) => ({
  batchId: 'x'.repeat(100),
  chunk: { index: 99_999, count: 100_000 },
  entries,
})

const entry = (id: string, size: number): SyncCrudEntry => ({
  table: 'cues',
  id,
  op: 'PUT',
  data: { notes: 'n'.repeat(size) },
})

test('splits on the entry count when entries are small, keeping order', () => {
  const entries = Array.from({ length: 900 }, (_, i) => entry(`c${i}`, 10))
  const chunks = toUploadChunks(entries)
  expect(chunks.map((c) => c.length)).toEqual([UPLOAD_CHUNK_MAX, UPLOAD_CHUNK_MAX, 100])
  expect(chunks.flat()).toEqual(entries)
})

test('splits on bytes: every chunk, sent with the largest envelope, stays within the budget', () => {
  const entries = Array.from({ length: 40 }, (_, i) => entry(`c${i}`, 100_000))
  const chunks = toUploadChunks(entries)
  expect(chunks.length).toBeGreaterThan(1)
  for (const chunk of chunks) expect(bytes(body(chunk))).toBeLessThanOrEqual(UPLOAD_CHUNK_MAX_BYTES)
  expect(chunks.flat()).toEqual(entries)
  // Each chunk is as full as the budget allows: adding the next entry would overflow it.
  for (const [i, chunk] of chunks.slice(0, -1).entries()) {
    expect(bytes(body([...chunk, chunks[i + 1][0]]))).toBeGreaterThan(UPLOAD_CHUNK_MAX_BYTES)
  }
})

test('counts UTF-8 bytes, not characters', () => {
  // 'é' is two bytes: 300 KB of characters is 600 KB on the wire.
  const entries = Array.from({ length: 4 }, (_, i) => ({
    ...entry(`c${i}`, 0),
    data: { notes: 'é'.repeat(300_000) },
  }))
  const chunks = toUploadChunks(entries)
  for (const chunk of chunks) expect(bytes(body(chunk))).toBeLessThanOrEqual(UPLOAD_CHUNK_MAX_BYTES)
  expect(chunks.map((c) => c.length)).toEqual([1, 1, 1, 1])
})

test('an entry larger than the budget still goes, alone', () => {
  const big = entry('big', UPLOAD_CHUNK_MAX_BYTES + 10)
  const chunks = toUploadChunks([entry('a', 10), big, entry('b', 10)])
  expect(chunks.map((c) => c.map((e) => e.id))).toEqual([['a'], ['big'], ['b']])
})

test('the largest valid cue entry fits one request well within the server limit', () => {
  // Worst case for JSON size: every string at its maximum length, made of a character JSON escapes
  // to six bytes (\u0001). NUL is refused by the schema, every other control character is valid.
  const s = (n: number) => '\u0001'.repeat(n)
  const anchor = {
    documentId: s(200),
    documentVersionId: s(200),
    pageIndex: 100_000,
    x: 14_400,
    y: 14_400,
    text: { quote: s(400), wordStart: 2_147_483_647, wordEnd: 2_147_483_647 },
    status: 'approximate' as const,
  }
  const fields = {
    departmentId: s(200),
    major: 9999,
    minor: 99,
    label: s(200),
    type: 'standby' as const,
    notes: s(10_000),
    colour: '#FFFFFF',
    anchor,
  }
  expect(cueFieldsSchema.safeParse(fields).success).toBe(true)
  const timestamp = '2026-10-15T10:00:00.000Z'
  const largest: SyncCrudEntry = {
    table: 'cues',
    id: '01a13b95-7928-77d0-b06b-84b0637737e2',
    op: 'PUT',
    // Every local column, as PowerSync sends them; the anchor is JSON text, escaped once more.
    data: {
      show_id: s(200),
      department_id: fields.departmentId,
      major: fields.major,
      minor: fields.minor,
      label: fields.label,
      anchor: JSON.stringify(anchor),
      type: fields.type,
      notes: fields.notes,
      colour: fields.colour,
      payload: '{}',
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: s(200),
    },
    clientTs: timestamp,
  }
  const size = bytes(body([largest]))
  expect(size).toBeLessThan(UPLOAD_CHUNK_MAX_BYTES)
  expect(size).toBeLessThan(SERVER_BODY_LIMIT)
  expect(UPLOAD_CHUNK_MAX_BYTES).toBeLessThan(SERVER_BODY_LIMIT)
})
