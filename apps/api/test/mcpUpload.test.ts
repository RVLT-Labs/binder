import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { changeLog, documents, documentUploads, documentVersions } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import { serve } from '@hono/node-server'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { readBlobBytes } from '../src/blob/BlobStore'
import {
  createShow,
  createToken,
  listOrganisations,
  receiveDocumentUpload,
  updateShow,
} from '../src/services'
import { sweepExpiredDocumentUploads } from '../src/services/documentUploads'
import { librettoBytes, setupShow } from './documentHelpers'
import { callTool, connectMcp, resultText, type ToolResult } from './mcpHelpers'
import { missingTools, processVersion } from './processingHelpers'
import { skipWithoutTools } from './tools'

type Setup = Awaited<ReturnType<typeof setupShow>>
let s: Setup
let editor: Client
let viewer: Client
let owner: Client
const clients: Client[] = []
const tokens: string[] = []
const actorOf = (userId: string) => ({ userId, via: 'web' as const, agent: null })

async function connect(userId: string, showScope: '*' | string[] = '*') {
  const { token } = await createToken(s.deps.db, actorOf(userId), { name: 't', showScope })
  tokens.push(token)
  const c = await connectMcp(s.app, token)
  clients.push(c)
  return c
}

beforeAll(async () => {
  s = await setupShow()
  editor = await connect(s.editor.id)
  viewer = await connect(s.viewer.id)
  owner = await connect(s.owner.id)
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const pdf = librettoBytes()

interface Begun {
  uploadId: string
  expiresAt: string
  put: { method: string; url: string; headers: Record<string, string> }
  curl: string
}

async function begin(client: Client, args: Record<string, unknown> = {}, bytes: Uint8Array = pdf) {
  return callTool(client, 'begin_document_upload', {
    showId: s.show.id,
    mode: 'new_document',
    kind: 'libretto',
    title: 'Private script',
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    ...args,
  })
}

async function begun(client: Client, args: Record<string, unknown> = {}, bytes: Uint8Array = pdf) {
  const r = await begin(client, args, bytes)
  expect(r.isError, resultText(r)).toBeFalsy()
  return r.structuredContent as Begun
}

/** The PUT the begin result describes, sent into the app (its path; the origin is APP_ORIGIN). */
function put(
  b: Begun,
  body: Uint8Array | ReadableStream<Uint8Array>,
  headers?: Record<string, string>,
) {
  return s.app.request(new URL(b.put.url).pathname, {
    method: 'PUT',
    headers: headers ?? b.put.headers,
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit)
}

const uploadRow = async (id: string) =>
  (await s.deps.db.select().from(documentUploads).where(eq(documentUploads.id, id)))[0]

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error

describe('the upload tools', () => {
  test('are listed with accurate hints and say how bytes travel', async () => {
    const { tools } = await editor.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))
    const beginTool = byName.get('begin_document_upload')
    expect(beginTool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(beginTool?.description).toContain('PUT')
    expect(beginTool?.description).toContain('sha256')
    expect(byName.get('complete_document_upload')?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
    })
    expect(byName.get('cancel_document_upload')?.annotations).toMatchObject({
      destructiveHint: true,
    })
    // The URL tool is unchanged and now points at the byte upload for local files.
    expect(byName.get('upload_document')?.description).toContain('begin_document_upload')
  })
})

describe('a new document from local bytes', () => {
  test('begin, PUT, complete: the same rows, log and queue as any upload', async () => {
    const b = await begun(editor)
    expect(b.put.method).toBe('PUT')
    expect(b.put.url).toBe(`${s.deps.config.APP_ORIGIN}/api/uploads/${b.uploadId}`)
    // The secret travels in a header, never in the URL.
    expect(b.put.headers.authorization).toMatch(/^Bearer bndu_[A-Za-z0-9_-]{40,}$/)
    expect(b.put.url).not.toContain('bndu_')
    expect(b.curl).toContain(`-T `)
    expect(b.curl).toContain(b.put.url)
    expect(new Date(b.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const row = await uploadRow(b.uploadId)
    expect(row.status).toBe('pending')
    // Only a hash of the secret is stored.
    expect(row.secretHash).not.toContain(b.put.headers.authorization.slice(7))

    const res = await put(b, pdf)
    expect(res.status, await res.clone().text()).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'received', sizeBytes: pdf.length })
    expect((await uploadRow(b.uploadId)).status).toBe('received')

    const done = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    expect(done.isError, resultText(done)).toBeFalsy()
    const { document, version } = done.structuredContent as {
      document: { id: string; title: string; kind: string; currentVersionId: string }
      version: { id: string; status: string; versionNumber: number; originalSizeBytes: number }
    }
    expect(document).toMatchObject({ title: 'Private script', kind: 'libretto' })
    expect(document.currentVersionId).toBe(version.id)
    expect(version).toMatchObject({ status: 'queued', versionNumber: 1 })
    expect(version.originalSizeBytes).toBe(pdf.length)
    expect(s.jobs.enqueued).toContain(version.id)

    // The stored original is byte-identical; the staging copy is gone.
    const [v] = await s.deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id))
    expect(sha256((await readBlobBytes(s.deps.blobs, v.originalKey)) as Buffer)).toBe(sha256(pdf))
    expect(await s.deps.blobs.exists(row.stagingKey)).toBe(false)

    // Attributed to the MCP client like any other MCP write.
    const logged = await s.deps.db.select().from(changeLog).where(eq(changeLog.rowId, document.id))
    expect(logged).toHaveLength(1)
    // Legacy-era clients are named by their User-Agent (see mcpHelpers).
    expect(logged[0]).toMatchObject({ via: 'mcp', userId: s.editor.id, agent: 'test-client/1.0' })
  })

  test('complete is idempotent: a retry returns the same document and makes no copy', async () => {
    const b = await begun(editor, { title: 'Twice' })
    expect((await put(b, pdf)).status).toBe(200)
    const first = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    const again = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    expect(again.isError, resultText(again)).toBeFalsy()
    expect(again.structuredContent).toEqual(first.structuredContent)
    const named = await s.deps.db.select().from(documents).where(eq(documents.title, 'Twice'))
    expect(named).toHaveLength(1)
  })

  test('a body over the 2 MB JSON limit is accepted on the upload route', async () => {
    const big = new Uint8Array(3 * 1024 * 1024).fill(0x20)
    big.set(new TextEncoder().encode('%PDF-1.7\n'))
    const b = await begun(editor, { title: 'Big' }, big)
    const res = await put(b, big)
    expect(res.status, await res.clone().text()).toBe(200)
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('a streamed body without Content-Length works', async () => {
    const b = await begun(editor, { title: 'Streamed' })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < pdf.length; i += 16 * 1024)
          controller.enqueue(pdf.slice(i, i + 16 * 1024))
        controller.close()
      },
    })
    expect((await put(b, body)).status).toBe(200)
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })
})

describe('the PUT refuses', () => {
  test('a wrong hash, then accepts the right bytes on retry', async () => {
    const b = await begun(editor, { title: 'Retry' })
    const tampered = Buffer.from(pdf)
    tampered[tampered.length - 10] ^= 0xff
    const bad = await put(b, tampered)
    expect(bad.status).toBe(400)
    expect(await errorOf(bad)).toBe('invalid')
    const row = await uploadRow(b.uploadId)
    expect(row.status).toBe('pending')
    expect(await s.deps.blobs.exists(row.stagingKey)).toBe(false)
    expect((await put(b, pdf)).status).toBe(200)
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('more or fewer bytes than declared', async () => {
    const b = await begun(editor, { title: 'Size' })
    const longer = await put(b, Buffer.concat([pdf, Buffer.from('extra')]))
    expect(longer.status).toBe(413)
    // The message names the declared size, not a rounded "0 MB".
    expect(((await longer.json()) as { message: string }).message).toContain(`${pdf.length} bytes`)
    const shorter = await put(b, pdf.subarray(0, pdf.length - 1))
    expect(shorter.status).toBe(400)
    expect((await uploadRow(b.uploadId)).status).toBe('pending')
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('a file that is not a PDF, even with a matching hash', async () => {
    const html = Buffer.from('<html><body>not a pdf</body></html>')
    const b = await begun(editor, { title: 'Html' }, html)
    const res = await put(b, html)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('not a PDF')
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('a missing, wrong or borrowed credential, and an unknown upload', async () => {
    const b = await begun(editor, { title: 'Auth' })
    const pdfHeaders = { 'content-type': 'application/pdf' }
    expect((await put(b, pdf, pdfHeaders)).status).toBe(401)
    const wrong = await put(b, pdf, { ...pdfHeaders, authorization: 'Bearer bndu_wrong' })
    expect(wrong.status).toBe(404)
    // The editor's own personal access token is not an upload secret.
    const pat = await put(b, pdf, { ...pdfHeaders, authorization: `Bearer ${tokens[0]}` })
    expect(pat.status).toBe(404)
    const unknown = await s.app.request('/api/uploads/nope', {
      method: 'PUT',
      headers: b.put.headers,
      body: pdf,
    })
    expect(unknown.status).toBe(404)
    expect((await uploadRow(b.uploadId)).status).toBe('pending')
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('a second PUT once the bytes are in', async () => {
    const b = await begun(editor, { title: 'Again' })
    expect((await put(b, pdf)).status).toBe(200)
    const again = await put(b, pdf)
    expect(again.status).toBe(409)
    expect(((await again.json()) as { message: string }).message).toContain(
      'complete_document_upload',
    )
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('after five failed attempts the upload takes no more', async () => {
    const b = await begun(editor, { title: 'Attempts' })
    for (let i = 0; i < 5; i++) expect((await put(b, Buffer.from('%PDF-no'))).status).toBe(400)
    expect((await put(b, pdf)).status).toBe(409)
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })
})

describe('begin_document_upload refuses', () => {
  test('viewers, archived shows and tokens scoped to another show', async () => {
    const asViewer = await begin(viewer)
    expect(asViewer.isError).toBe(true)
    expect(resultText(asViewer)).toMatch(/^forbidden/)

    // A token of the owner scoped to their other show cannot reach this one.
    const [org] = await listOrganisations(s.deps.db, s.ownerActor)
    const second = await createShow(s.deps.db, s.ownerActor, {
      organisationId: org.id,
      title: 'Second',
    })
    const scoped = await connect(s.owner.id, [second.id])
    const outOfScope = await begin(scoped)
    expect(outOfScope.isError).toBe(true)
    expect(resultText(outOfScope)).toMatch(/^(forbidden|not_found)/)

    const archived = await setupShowArchived()
    expect(archived.isError).toBe(true)
    expect(resultText(archived)).toMatch(/^forbidden/)
  })

  test('a declared size over 200 MB or a malformed hash', async () => {
    const big = await begin(editor, { sizeBytes: 200 * 1024 * 1024 + 1 })
    expect(resultText(big)).toMatch(/^payload_too_large/)
    const hash = await begin(editor, { sha256: 'abc' })
    expect(hash.isError).toBe(true)
    const zero = await begin(editor, { sizeBytes: 0 })
    expect(zero.isError).toBe(true)
  })

  test('arguments that do not belong to the mode', async () => {
    const docForNew = await begin(editor, { documentId: 'x' })
    expect(resultText(docForNew)).toMatch(/^invalid/)
    const labelForNew = await begin(editor, { label: 'x' })
    expect(resultText(labelForNew)).toMatch(/^invalid/)
    const noKind = await begin(editor, { kind: undefined })
    expect(resultText(noKind)).toMatch(/^invalid/)
    const kindForVersion = await begin(editor, {
      mode: 'new_version',
      documentId: 'x',
      label: 'Cut 2',
      confirm: true,
    })
    expect(resultText(kindForVersion)).toMatch(/^invalid/)
  })

  test('more than five unfinished uploads per user', async () => {
    const open: Begun[] = []
    // Earlier tests cancelled or completed theirs; fill up to the cap.
    for (;;) {
      const r = await begin(owner, { title: `Open ${open.length}` })
      if (r.isError) {
        expect(resultText(r)).toMatch(/^conflict/)
        break
      }
      open.push(r.structuredContent as Begun)
      expect(open.length).toBeLessThanOrEqual(5)
    }
    expect(open).toHaveLength(5)
    await callTool(owner, 'cancel_document_upload', { uploadId: open[0].uploadId })
    const after = await begin(owner, { title: 'After cancel' })
    expect(after.isError, resultText(after)).toBeFalsy()
    for (const b of [...open.slice(1), after.structuredContent as Begun]) {
      await callTool(owner, 'cancel_document_upload', { uploadId: b.uploadId })
    }
  })
})

async function setupShowArchived(): Promise<ToolResult> {
  const other = await setupShow()
  await updateShow(other.deps.db, other.ownerActor, {
    showId: other.show.id,
    patch: { status: 'archived' },
  })
  const { token } = await createToken(other.deps.db, actorOf(other.editor.id), {
    name: 't',
    showScope: '*',
  })
  const c = await connectMcp(other.app, token)
  clients.push(c)
  return callTool(c, 'begin_document_upload', {
    showId: other.show.id,
    mode: 'new_document',
    kind: 'libretto',
    title: 'Archived',
    sizeBytes: pdf.length,
    sha256: sha256(pdf),
  })
}

describe('a new version from local bytes', () => {
  let documentId: string
  beforeAll(async () => {
    const b = await begun(editor, { title: 'Versioned' })
    await put(b, pdf)
    const done = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    documentId = (done.structuredContent as { document: { id: string } }).document.id
  })

  test('needs confirm, because the version re-anchors and becomes current', async () => {
    const before = (await s.deps.db.select().from(documentUploads)).length
    const r = await begin(editor, {
      mode: 'new_version',
      documentId,
      label: 'Cut 2',
      kind: undefined,
      title: undefined,
    })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toMatch(/^CONFIRMATION_REQUIRED/)
    expect(resultText(r)).toContain('re-anchor')
    expect((await s.deps.db.select().from(documentUploads)).length).toBe(before)
  })

  test('with confirm it adds the next version and leaves the current one in place', async () => {
    const b = await begun(editor, {
      mode: 'new_version',
      documentId,
      label: 'Cut 2',
      kind: undefined,
      title: undefined,
      confirm: true,
    })
    expect((await put(b, pdf)).status).toBe(200)
    const done = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    expect(done.isError, resultText(done)).toBeFalsy()
    const { document, version } = done.structuredContent as {
      document: { id: string; currentVersionId: string }
      version: { id: string; versionNumber: number; label: string }
    }
    expect(document.id).toBe(documentId)
    expect(version).toMatchObject({ versionNumber: 2, label: 'Cut 2' })
    expect(document.currentVersionId).not.toBe(version.id)
  })

  test('a document of another show is not found', async () => {
    const other = await setupShow()
    const r = await begin(editor, {
      mode: 'new_version',
      documentId,
      label: 'x',
      kind: undefined,
      title: undefined,
      confirm: true,
      showId: other.show.id,
    })
    expect(resultText(r)).toMatch(/^(forbidden|not_found)/)
  })
})

describe('complete and cancel', () => {
  test('complete before the bytes arrive is a conflict', async () => {
    const b = await begun(editor, { title: 'Early' })
    const r = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    expect(resultText(r)).toMatch(/^conflict/)
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test("another user's upload is not found", async () => {
    const b = await begun(editor, { title: 'Mine' })
    await put(b, pdf)
    for (const name of ['complete_document_upload', 'cancel_document_upload']) {
      const r = await callTool(owner, name, { uploadId: b.uploadId })
      expect(resultText(r), name).toMatch(/^not_found/)
    }
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('complete re-checks the show: archived after the PUT is refused and can be retried', async () => {
    const other = await setupShow()
    const { token } = await createToken(other.deps.db, actorOf(other.editor.id), {
      name: 't',
      showScope: '*',
    })
    const c = await connectMcp(other.app, token)
    clients.push(c)
    const r = await callTool(c, 'begin_document_upload', {
      showId: other.show.id,
      mode: 'new_document',
      kind: 'libretto',
      title: 'Late archive',
      sizeBytes: pdf.length,
      sha256: sha256(pdf),
    })
    const b = r.structuredContent as Begun
    const res = await other.app.request(new URL(b.put.url).pathname, {
      method: 'PUT',
      headers: b.put.headers,
      body: pdf,
    })
    expect(res.status).toBe(200)
    await updateShow(other.deps.db, other.ownerActor, {
      showId: other.show.id,
      patch: { status: 'archived' },
    })
    const done = await callTool(c, 'complete_document_upload', { uploadId: b.uploadId })
    expect(resultText(done)).toMatch(/^forbidden/)
    const [row] = await other.deps.db
      .select()
      .from(documentUploads)
      .where(eq(documentUploads.id, b.uploadId))
    expect(row.status).toBe('received')
    expect(
      await other.deps.db.select().from(documents).where(eq(documents.showId, other.show.id)),
    ).toHaveLength(0)
  })

  test('cancel removes the staged bytes; the upload is then gone', async () => {
    const b = await begun(editor, { title: 'Cancel' })
    await put(b, pdf)
    const row = await uploadRow(b.uploadId)
    expect(await s.deps.blobs.exists(row.stagingKey)).toBe(true)
    const r = await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
    expect(r.isError, resultText(r)).toBeFalsy()
    expect(await s.deps.blobs.exists(row.stagingKey)).toBe(false)
    expect(await uploadRow(b.uploadId)).toBeUndefined()
    expect((await put(b, pdf)).status).toBe(404)
    const done = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    expect(resultText(done)).toMatch(/^not_found/)
  })

  test('a completed upload cannot be cancelled', async () => {
    const b = await begun(editor, { title: 'Done' })
    await put(b, pdf)
    await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    const r = await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
    expect(resultText(r)).toMatch(/^conflict/)
  })
})

describe('abandoned uploads', () => {
  test('expire: the sweep removes the row and the staged bytes, and the PUT is refused', async () => {
    const b = await begun(editor, { title: 'Abandoned' })
    await put(b, pdf)
    const row = await uploadRow(b.uploadId)
    expect(await s.deps.blobs.exists(row.stagingKey)).toBe(true)
    await s.deps.db
      .update(documentUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(documentUploads.id, b.uploadId))
    const done = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    expect(resultText(done)).toMatch(/^not_found/)
    expect(await sweepExpiredDocumentUploads(s.deps.db, s.deps.blobs)).toBeGreaterThanOrEqual(1)
    expect(await uploadRow(b.uploadId)).toBeUndefined()
    expect(await s.deps.blobs.exists(row.stagingKey)).toBe(false)
    expect((await put(b, pdf)).status).toBe(404)
  })

  test('an expired pending upload is refused before any byte is stored', async () => {
    const b = await begun(editor, { title: 'Late' })
    await s.deps.db
      .update(documentUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(documentUploads.id, b.uploadId))
    expect((await put(b, pdf)).status).toBe(404)
    const row = await uploadRow(b.uploadId)
    expect(await s.deps.blobs.exists(row.stagingKey)).toBe(false)
  })
})

/** Resolves to 'timeout' when `p` has not settled within `ms`: a hang is a failure, not a stuck test. */
const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])

describe('hardening', () => {
  test('staged bytes are never served from /blobs, to a viewer or to the uploader', async () => {
    const b = await begun(editor, { title: 'Staged' })
    expect((await put(b, pdf)).status).toBe(200)
    const { stagingKey } = await uploadRow(b.uploadId)
    expect(await s.deps.blobs.exists(stagingKey)).toBe(true)
    for (const cookie of [s.viewer.cookie, s.editor.cookie, s.owner.cookie]) {
      const res = await s.app.request(`/blobs/${stagingKey}`, { headers: { cookie } })
      expect(res.status).toBe(404)
    }
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('a store that fails before reading the body fails the PUT promptly and frees the upload', async () => {
    const b = await begun(editor, { title: 'Store fails' })
    const spy = vi.spyOn(s.deps.blobs, 'put').mockImplementationOnce(async () => {
      throw new Error('disk full')
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await within(Promise.resolve(put(b, pdf)), 5000)
      expect(res, 'the PUT hung').not.toBe('timeout')
      expect((res as Response).status).toBe(500)
    } finally {
      spy.mockRestore()
      errors.mockRestore()
    }
    expect((await uploadRow(b.uploadId)).status).toBe('pending')
    expect((await put(b, pdf)).status).toBe(200)
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('a client that drops the connection mid-PUT frees the upload for a retry', async () => {
    const { request } = await import('node:http')
    const server = serve({ fetch: s.app.fetch, port: 0, hostname: '127.0.0.1' })
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    try {
      const port = (server.address() as AddressInfo).port
      const b = await begun(editor, { title: 'Dropped' })
      const req = request({
        host: '127.0.0.1',
        port,
        method: 'PUT',
        path: new URL(b.put.url).pathname,
        headers: { ...b.put.headers, 'content-length': String(pdf.length) },
      })
      req.on('error', () => {})
      req.write(pdf.subarray(0, Math.floor(pdf.length / 2)))
      await new Promise((r) => setTimeout(r, 200))
      expect((await uploadRow(b.uploadId)).status).toBe('receiving')
      req.destroy()
      let status = 'receiving'
      for (let i = 0; i < 50 && status === 'receiving'; i++) {
        await new Promise((r) => setTimeout(r, 100))
        status = (await uploadRow(b.uploadId)).status
      }
      expect(status).toBe('pending')
      const { stagingKey } = await uploadRow(b.uploadId)
      expect(await s.deps.blobs.exists(stagingKey)).toBe(false)
      expect((await put(b, pdf)).status).toBe(200)
      await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
    } finally {
      server.close()
    }
  }, 20_000)

  test('a slow PUT is not swept mid-transfer, and the completion window starts when the bytes are in', async () => {
    const b = await begun(editor, { title: 'Slow' })
    const started = new Date(Date.now() - 40 * 60 * 1000)
    // A PUT that began 40 minutes ago (longer than the 30-minute window) and is only now done.
    const result = await receiveDocumentUpload(
      s.deps.db,
      s.deps.blobs,
      {
        uploadId: b.uploadId,
        secret: b.put.headers.authorization.slice('Bearer '.length),
        body: Readable.from([pdf]),
      },
      started,
    )
    expect(result.status).toBe('received')
    const row = await uploadRow(b.uploadId)
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000)
    await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
  })

  test('a completion that committed but was never recorded is recovered, not repeated', async () => {
    for (const mode of ['new_document', 'new_version'] as const) {
      const args =
        mode === 'new_document'
          ? { title: 'Recovered' }
          : {
              mode,
              documentId: (
                await s.deps.db.select().from(documents).where(eq(documents.showId, s.show.id))
              )[0].id,
              label: 'Recovered cut',
              kind: undefined,
              title: undefined,
              confirm: true,
            }
      const b = await begun(editor, args)
      expect((await put(b, pdf)).status).toBe(200)
      // The process died after the document service committed and before the upload row said so.
      const original = s.deps.db.update.bind(s.deps.db)
      let calls = 0
      const spy = vi.spyOn(s.deps.db, 'update').mockImplementation(((table) => {
        // Of the upload's own updates, 1 is the claim and 2 the "completed" record, which fails as
        // a crash would. (Other updates, such as the token's last-used time, pass through.)
        if ((table as unknown) === documentUploads && ++calls === 2) {
          throw new Error('connection lost')
        }
        return original(table)
      }) as typeof s.deps.db.update)
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      const first = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
      spy.mockRestore()
      errors.mockRestore()
      expect(first.isError, mode).toBe(true)
      expect((await uploadRow(b.uploadId)).status, mode).toBe('completing')
      const retry = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
      expect(retry.isError, `${mode}: ${resultText(retry)}`).toBeFalsy()
      const { version } = retry.structuredContent as {
        version: { id: string; documentId?: string }
      }
      const versions = await s.deps.db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.originalSizeBytes, pdf.length))
      expect(
        versions.filter((v) => v.id === version.id),
        mode,
      ).toHaveLength(1)
      expect((await uploadRow(b.uploadId)).status, mode).toBe('completed')
      const logged = await s.deps.db
        .select()
        .from(changeLog)
        .where(eq(changeLog.batchId, b.uploadId))
      // Exactly one version insert in the upload's batch: nothing was stored twice.
      expect(
        logged.filter((l) => l.tableName === 'document_versions'),
        mode,
      ).toHaveLength(1)
    }
  })

  test('a document service that fails after its commit is never run twice (F1)', async () => {
    for (const mode of ['new_document', 'new_version'] as const) {
      const args =
        mode === 'new_document'
          ? { title: 'Committed then failed' }
          : {
              mode,
              documentId: (
                await s.deps.db.select().from(documents).where(eq(documents.showId, s.show.id))
              )[0].id,
              label: 'Committed then failed cut',
              kind: undefined,
              title: undefined,
              confirm: true,
            }
      const b = await begun(editor, args)
      expect((await put(b, pdf)).status).toBe(200)
      // The rows commit, then queueing fails and so does marking the version failed: the service
      // throws after its commit.
      const enqueue = vi
        .spyOn(s.jobs, 'enqueueDocumentProcess')
        .mockRejectedValueOnce(new Error('queue down'))
      const original = s.deps.db.update.bind(s.deps.db)
      let marked = false
      const update = vi.spyOn(s.deps.db, 'update').mockImplementation(((table) => {
        if ((table as unknown) === documentVersions && !marked) {
          marked = true
          throw new Error('connection lost')
        }
        return original(table)
      }) as typeof s.deps.db.update)
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      const first = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
      update.mockRestore()
      enqueue.mockRestore()
      errors.mockRestore()
      expect(marked, mode).toBe(true)
      expect(first.isError, mode).toBe(true)
      // What committed is recorded, so the retry returns it instead of storing the file again.
      expect((await uploadRow(b.uploadId)).status, mode).toBe('completed')
      const retry = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
      expect(retry.isError, `${mode}: ${resultText(retry)}`).toBeFalsy()
      const inserted = (
        await s.deps.db.select().from(changeLog).where(eq(changeLog.batchId, b.uploadId))
      ).filter((l) => l.tableName === 'document_versions')
      expect(inserted, mode).toHaveLength(1)
      const { version } = retry.structuredContent as { version: { id: string } }
      expect(version.id, mode).toBe(inserted[0].rowId)
    }
  })

  test('concurrent completes make exactly one document', async () => {
    const b = await begun(editor, { title: 'Racing' })
    expect((await put(b, pdf)).status).toBe(200)
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        callTool(editor, 'complete_document_upload', { uploadId: b.uploadId }),
      ),
    )
    const ok = results.filter((r) => !r.isError)
    expect(ok.length).toBeGreaterThanOrEqual(1)
    for (const r of results.filter((x) => x.isError)) expect(resultText(r)).toMatch(/^conflict/)
    const made = await s.deps.db.select().from(documents).where(eq(documents.title, 'Racing'))
    expect(made).toHaveLength(1)
    const again = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    expect((again.structuredContent as { document: { id: string } }).document.id).toBe(made[0].id)
  })

  test('a cancel or a sweep while the bytes arrive leaves nothing staged', async () => {
    for (const interrupt of ['cancel', 'sweep'] as const) {
      const b = await begun(editor, { title: `Interrupted by ${interrupt}` })
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => {
        release = r
      })
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(pdf.subarray(0, 1024))
          await gate
          controller.enqueue(pdf.subarray(1024))
          controller.close()
        },
      })
      const pending = put(b, body)
      for (let i = 0; i < 50 && (await uploadRow(b.uploadId)).status !== 'receiving'; i++) {
        await new Promise((r) => setTimeout(r, 20))
      }
      const { stagingKey } = await uploadRow(b.uploadId)
      if (interrupt === 'cancel') {
        await callTool(editor, 'cancel_document_upload', { uploadId: b.uploadId })
      } else {
        await s.deps.db
          .update(documentUploads)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(documentUploads.id, b.uploadId))
        await sweepExpiredDocumentUploads(s.deps.db, s.deps.blobs)
      }
      release()
      expect((await pending).status, interrupt).toBe(404)
      expect(await uploadRow(b.uploadId)).toBeUndefined()
      expect(await s.deps.blobs.exists(stagingKey), interrupt).toBe(false)
    }
  })
})

describe('logging', () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = []
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore()
  })

  test('no secret, token or PDF byte reaches the console, even on failures', async () => {
    const lines: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          lines.push(
            args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '),
          )
        }),
      )
    }
    const b = await begun(editor, { title: 'Quiet' })
    const secret = b.put.headers.authorization.slice('Bearer '.length)
    await put(b, Buffer.from('not a pdf at all'))
    await put(b, pdf, { 'content-type': 'application/pdf', authorization: 'Bearer bndu_wrong' })
    await put(b, pdf)
    await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
    const all = lines.join('\n')
    expect(all).not.toContain(secret)
    for (const t of tokens) expect(all).not.toContain(t)
    expect(all).not.toContain('%PDF-')
    expect(all).not.toContain(pdf.subarray(0, 64).toString('base64'))
  })
})

const missing = missingTools.filter((t) => t !== 'ocrmypdf')
describe.skipIf(skipWithoutTools('MCP local upload integration', missing))(
  'real processing over HTTP with the returned curl command',
  () => {
    test('upload -> ready -> the text is searchable', async () => {
      const bytes = (await import('node:fs')).readFileSync(FIXTURES.librettoShortPdf)
      const server = serve({ fetch: s.app.fetch, port: 0, hostname: '127.0.0.1' })
      await new Promise<void>((resolve) => server.once('listening', () => resolve()))
      try {
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        const r = await begin(editor, { title: 'Pirates', ocrMode: 'never' }, bytes)
        expect(r.isError, resultText(r)).toBeFalsy()
        const b = r.structuredContent as Begun
        const dir = await mkdtemp(join(tmpdir(), 'binder-upload-'))
        const file = join(dir, 'script.pdf')
        writeFileSync(file, bytes)
        // Run the command exactly as returned, with the file path and origin filled in.
        const command = b.curl.replace(s.deps.config.APP_ORIGIN, origin).replace('script.pdf', file)
        const { stdout } = await promisify(execFile)('sh', ['-c', command])
        expect(JSON.parse(stdout)).toMatchObject({ status: 'received', sizeBytes: bytes.length })

        const done = await callTool(editor, 'complete_document_upload', { uploadId: b.uploadId })
        const { document, version } = done.structuredContent as {
          document: { id: string }
          version: { id: string }
        }
        await processVersion({ ...s.deps, jobs: s.jobs }, version.id)

        const got = await callTool(editor, 'get_document', { documentId: document.id })
        const v = (got.structuredContent as { version: { status: string; pageCount: number } })
          .version
        expect(v.status).toBe('ready')
        expect(v.pageCount).toBe(3)
        const found = await callTool(editor, 'search_script', {
          versionId: version.id,
          query: 'PIRATE KING',
        })
        expect(found.isError, resultText(found)).toBeFalsy()
        expect((found.structuredContent as { hits: unknown[] }).hits.length).toBeGreaterThan(0)
      } finally {
        server.close()
      }
    }, 60_000)
  },
)
