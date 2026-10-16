import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { DiskBlobStore } from '../src/blob/DiskBlobStore'

let root: string
let store: DiskBlobStore
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'blob-'))
  store = new DiskBlobStore(root)
})
afterAll(() => rm(root, { recursive: true, force: true }))

async function toBuffer(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of s) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks)
}

test('put, get, exists, delete round-trip with content type', async () => {
  const key = 'shows/s1/documents/d1/versions/v1/original.pdf'
  const body = new Uint8Array([1, 2, 3, 4])
  await store.put(key, body, 'application/pdf')
  const got = await store.get(key)
  if (!got) throw new Error('expected blob')
  expect(got.contentType).toBe('application/pdf')
  expect(got.size).toBe(4)
  expect(await toBuffer(got.stream)).toEqual(Buffer.from(body))
  expect(await store.exists(key)).toBe(true)
  expect(store.localPath(key)).toBe(join(root, key))
  await store.delete(key)
  expect(await store.exists(key)).toBe(false)
  expect(await store.get(key)).toBeNull()
})

test('put returns the stored size, for bytes and for a stream', async () => {
  expect(await store.put('shows/s1/size-bytes.bin', new Uint8Array(7), 'x')).toEqual({ size: 7 })
  const streamed = Readable.from([Buffer.from('ab'), Buffer.from('cde')])
  expect(await store.put('shows/s1/size-stream.bin', streamed, 'x')).toEqual({ size: 5 })
})

test('put accepts a stream', async () => {
  const key = 'shows/s1/stream.bin'
  await store.put(
    key,
    Readable.from([Buffer.from('ab'), Buffer.from('cd')]),
    'application/octet-stream',
  )
  const got = await store.get(key)
  if (!got) throw new Error('expected blob')
  expect(await toBuffer(got.stream)).toEqual(Buffer.from('abcd'))
})

test('delete of a missing key is a no-op', async () => {
  await expect(store.delete('shows/s1/missing.bin')).resolves.toBeUndefined()
})

test('never writes outside root', async () => {
  await expect(store.put('../escape', new Uint8Array(1), 'x')).rejects.toThrow()
  await expect(store.put('shows/../../escape', new Uint8Array(1), 'x')).rejects.toThrow()
  await expect(store.get('../escape')).rejects.toThrow()
})

test('leaves no temp files behind', async () => {
  const entries = await readdir(root, { recursive: true })
  expect(entries.filter((e) => e.includes('.tmp'))).toEqual([])
})
