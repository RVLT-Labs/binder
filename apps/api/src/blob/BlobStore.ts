import type { Readable } from 'node:stream'

export interface BlobStore {
  put(key: string, body: Readable | Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<{ stream: Readable; size: number; contentType: string } | null>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  /** Absolute filesystem path, for stores that have one (processing jobs shell out to tools). */
  localPath?(key: string): string
}
