import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { BlobStore } from './BlobStore'
import { validateBlobKey } from './keys'

export class DiskBlobStore implements BlobStore {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  localPath(key: string): string {
    validateBlobKey(key)
    const path = resolve(this.root, key)
    // Defence in depth beyond key validation: the resolved path must stay inside the root.
    if (!path.startsWith(this.root + sep)) throw new Error('Blob path escapes the store root')
    return path
  }

  async put(key: string, body: Readable | Uint8Array, contentType: string): Promise<void> {
    const path = this.localPath(key)
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
    try {
      if (body instanceof Uint8Array) await writeFile(tmp, body)
      else await pipeline(body, createWriteStream(tmp))
      await rename(tmp, path)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
    await writeFile(`${path}.meta.json`, JSON.stringify({ contentType }))
  }

  async get(key: string) {
    const path = this.localPath(key)
    let size: number
    try {
      size = (await stat(path)).size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    return { stream: createReadStream(path), size, contentType: await this.contentType(path) }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.localPath(key))).isFile()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.localPath(key)
    await rm(path, { force: true })
    await rm(`${path}.meta.json`, { force: true })
  }

  private async contentType(path: string): Promise<string> {
    try {
      const meta = JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as {
        contentType?: string
      }
      return meta.contentType ?? 'application/octet-stream'
    } catch {
      return 'application/octet-stream'
    }
  }
}
