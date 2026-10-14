import type { SyncCrudEntry } from '@binder/shared'

/** Entries per upload request; the API accepts up to 500, so a full chunk has room to spare. */
export const UPLOAD_CHUNK_MAX = 400

/** Splits one PowerSync transaction's entries into upload requests, keeping their order. */
export function toUploadChunks(
  entries: SyncCrudEntry[],
  max = UPLOAD_CHUNK_MAX,
): SyncCrudEntry[][] {
  if (!Number.isInteger(max) || max < 1)
    throw new RangeError('chunk size must be a positive integer')
  const chunks: SyncCrudEntry[][] = []
  for (let i = 0; i < entries.length; i += max) chunks.push(entries.slice(i, i + max))
  return chunks
}
