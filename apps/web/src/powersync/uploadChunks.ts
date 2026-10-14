import type { SyncCrudEntry } from '@binder/shared'

/** Entries per upload request; the API accepts up to 500, so a full chunk has room to spare. */
export const UPLOAD_CHUNK_MAX = 400

/**
 * Bytes per upload request, envelope included: half the API's 2 MiB JSON body limit, which a request
 * over would meet with a 413 on every retry, wedging the queue. The largest valid entry is far below
 * this, so an entry that is alone in its chunk always fits (see uploadChunks.test.ts).
 */
export const UPLOAD_CHUNK_MAX_BYTES = 1024 * 1024

const encoder = new TextEncoder()
const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).length

/** The request around the entries at its largest: the longest batch id and chunk numbers allowed. */
const ENVELOPE_BYTES = byteLength({
  batchId: 'x'.repeat(100),
  chunk: { index: 99_999, count: 100_000 },
  entries: [],
})

/**
 * Splits one PowerSync transaction's entries into upload requests, keeping their order. A chunk
 * closes at `max` entries or when the next entry would take the request over `maxBytes`; an entry
 * bigger than that on its own still goes, alone.
 */
export function toUploadChunks(
  entries: SyncCrudEntry[],
  max = UPLOAD_CHUNK_MAX,
  maxBytes = UPLOAD_CHUNK_MAX_BYTES,
): SyncCrudEntry[][] {
  if (!Number.isInteger(max) || max < 1)
    throw new RangeError('chunk size must be a positive integer')
  const chunks: SyncCrudEntry[][] = []
  let chunk: SyncCrudEntry[] = []
  let size = ENVELOPE_BYTES
  for (const entry of entries) {
    const entryBytes = byteLength(entry)
    // Entries after the first in a chunk are preceded by a comma.
    if (chunk.length > 0 && (chunk.length >= max || size + 1 + entryBytes > maxBytes)) {
      chunks.push(chunk)
      chunk = []
      size = ENVELOPE_BYTES
    }
    size += entryBytes + (chunk.length > 0 ? 1 : 0)
    chunk.push(entry)
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}
