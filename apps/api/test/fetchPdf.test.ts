import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { documents } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { uploadDocumentFromUrl } from '../src/services'
import { fetchPdf, isPublicAddress } from '../src/upload/fetchPdf'
import { setupShow } from './documentHelpers'

const pdf = readFileSync(FIXTURES.librettoPdf)
const allowAll = { allowAddress: () => true }

let server: Server
let base: string
let requests = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    requests++
    if (req.url === '/script.pdf') return res.end(pdf)
    if (req.url === '/not-a-pdf') return res.end('hello, not a pdf')
    if (req.url === '/missing') {
      res.statusCode = 404
      return res.end()
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/script.pdf' })
      return res.end()
    }
    if (req.url === '/to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' })
      return res.end()
    }
    if (req.url === '/stall') {
      res.write(pdf.subarray(0, 1024))
      return // never ends
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

async function bytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

describe('isPublicAddress', () => {
  test.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fd00:ec2::254',
    'not-an-ip',
  ])('%s is refused', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  test.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('%s is allowed', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })
})

describe('fetchPdf', () => {
  test('refuses non-http schemes', async () => {
    for (const url of [`file://${FIXTURES.librettoPdf}`, 'ftp://example.com/a.pdf', 'data:,x']) {
      await expect(fetchPdf(url)).rejects.toThrow(/Only http and https/)
    }
  })

  test('refuses loopback, by literal address and by name', async () => {
    await expect(fetchPdf(`${base}/script.pdf`)).rejects.toThrow(/private or reserved/)
    const port = new URL(base).port
    await expect(fetchPdf(`http://localhost:${port}/script.pdf`)).rejects.toThrow(
      /private or reserved/,
    )
    await expect(fetchPdf(`http://[::1]:${port}/script.pdf`)).rejects.toThrow(/private or reserved/)
  })

  test('resolves host names through the guarded lookup', async () => {
    const port = new URL(base).port
    const stream = await fetchPdf(`http://localhost:${port}/script.pdf`, allowAll)
    expect((await bytes(stream)).equals(pdf)).toBe(true)
  })

  test('streams a PDF and follows redirects', async () => {
    expect((await bytes(await fetchPdf(`${base}/script.pdf`, allowAll))).equals(pdf)).toBe(true)
    expect((await bytes(await fetchPdf(`${base}/redirect`, allowAll))).equals(pdf)).toBe(true)
  })

  test('re-checks the address after a redirect', async () => {
    const allowLoopbackOnly = { allowAddress: (a: string) => a === '127.0.0.1' }
    await expect(fetchPdf(`${base}/to-metadata`, allowLoopbackOnly)).rejects.toThrow(
      /private or reserved/,
    )
  })

  test('refuses non-PDF bodies and failed responses', async () => {
    await expect(fetchPdf(`${base}/not-a-pdf`, allowAll)).rejects.toThrow(/not a PDF/)
    await expect(fetchPdf(`${base}/missing`, allowAll)).rejects.toThrow(/HTTP 404/)
  })

  test('enforces the size cap from the declared length and while streaming', async () => {
    await expect(
      fetchPdf(`${base}/script.pdf`, { ...allowAll, maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    // No Content-Length: the byte count trips the cap while streaming.
    const stream = await fetchPdf(`${base}/stall`, { ...allowAll, maxBytes: 512 }).catch((e) => e)
    expect(stream).toMatchObject({ code: 'payload_too_large' })
  })

  test('times out a stalled download', async () => {
    const stream = await fetchPdf(`${base}/stall`, { ...allowAll, timeoutMs: 300 })
    await expect(bytes(stream)).rejects.toThrow(/timed out/)
  })
})

describe('uploadDocumentFromUrl', () => {
  test('uploadDocumentFromUrl records the size', async () => {
    const s = await setupShow()
    const { version } = await uploadDocumentFromUrl(
      s.deps.db,
      s.deps.blobs,
      s.jobs,
      s.ownerActor,
      { showId: s.show.id, url: `${base}/script.pdf`, kind: 'libretto' },
      allowAll,
    )
    expect(version.originalSizeBytes).toBe(pdf.length)
  })

  test('creates a document from a fetched PDF', async () => {
    const s = await setupShow()
    const { document, version } = await uploadDocumentFromUrl(
      s.deps.db,
      s.deps.blobs,
      s.jobs,
      s.ownerActor,
      { showId: s.show.id, url: `${base}/script.pdf`, kind: 'libretto' },
      allowAll,
    )
    expect(document.title).toBe('script')
    expect(s.jobs.enqueued).toContain(version.id)
    const stored = await s.deps.blobs.get(version.originalKey)
    expect(stored?.size).toBe(pdf.length)

    const next = await uploadDocumentFromUrl(
      s.deps.db,
      s.deps.blobs,
      s.jobs,
      s.ownerActor,
      { showId: s.show.id, url: `${base}/redirect`, documentId: document.id, label: 'Rev 2' },
      allowAll,
    )
    expect(next.version).toMatchObject({
      documentId: document.id,
      versionNumber: 2,
      label: 'Rev 2',
    })
  })

  test('a viewer cannot make the server fetch', async () => {
    const s = await setupShow()
    const before = requests
    await expect(
      uploadDocumentFromUrl(
        s.deps.db,
        s.deps.blobs,
        s.jobs,
        { userId: s.viewer.id, via: 'mcp', agent: null },
        { showId: s.show.id, url: `${base}/script.pdf`, kind: 'libretto' },
        allowAll,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(requests).toBe(before)
    const docs = await s.deps.db.select().from(documents).where(eq(documents.showId, s.show.id))
    expect(docs).toHaveLength(0)
  })
})
