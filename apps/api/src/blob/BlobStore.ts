import type { Readable } from 'node:stream'

export interface BlobStore {
  /** Stores the body and returns how many bytes were stored. */
  put(key: string, body: Readable | Uint8Array, contentType: string): Promise<{ size: number }>
  get(key: string): Promise<{ stream: Readable; size: number; contentType: string } | null>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  /** Absolute filesystem path, for stores that have one (processing jobs shell out to tools). */
  localPath?(key: string): string
}

/** A whole blob in memory, or null when it does not exist. For small blobs (word layers, page images). */
export async function readBlobBytes(blobs: BlobStore, key: string): Promise<Buffer | null> {
  const blob = await blobs.get(key)
  if (!blob) return null
  const chunks: Buffer[] = []
  for await (const chunk of blob.stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}
