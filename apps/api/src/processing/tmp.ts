import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { BlobStore } from '../blob/BlobStore'

/** Runs `fn` with a fresh per-job temp directory, removed afterwards whatever happens. */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * A filesystem path for a blob, for tools that need one: the store's own path when it has one,
 * otherwise a copy written into `dir` as `name`.
 */
export async function blobFile(
  blobs: BlobStore,
  key: string,
  dir: string,
  name: string,
): Promise<string> {
  if (blobs.localPath) {
    if (!(await blobs.exists(key))) throw new Error(`blob ${key} is missing`)
    return blobs.localPath(key)
  }
  const blob = await blobs.get(key)
  if (!blob) throw new Error(`blob ${key} is missing`)
  const path = join(dir, name)
  await pipeline(blob.stream, createWriteStream(path))
  return path
}
