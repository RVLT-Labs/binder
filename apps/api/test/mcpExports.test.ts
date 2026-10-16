import { Readable } from 'node:stream'
import { documentVersions } from '@binder/db'
import { newId } from '@binder/shared'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { searchableBlobKey } from '../src/blob/keys'
import {
  createExportRecord,
  createShow,
  createToken,
  listExportRecords,
  listOrganisations,
} from '../src/services'
import type { Json } from './documentHelpers'
import { librettoBytes } from './documentHelpers'
import { setupMarkupShow } from './markupHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>
let s: Setup
let owner: Client
let viewer: Client
let scoped: Client
let privateId: string
const clients: Client[] = []

async function connect(userId: string, showScope: '*' | string[] = '*') {
  const actor = { userId, via: 'web' as const, agent: null }
  const { token } = await createToken(s.deps.db, actor, { name: 't', showScope })
  const c = await connectMcp(s.app, token)
  clients.push(c)
  return c
}

const uriOf = (id: string) => `binder://shows/${s.show.id}/exports/${id}`

beforeAll(async () => {
  s = await setupMarkupShow()
  const key = searchableBlobKey(s.show.id, s.docId, s.versionId)
  await s.deps.blobs.put(key, new Uint8Array(librettoBytes()), 'application/pdf')
  await s.deps.db
    .update(documentVersions)
    .set({ searchableKey: key })
    .where(eq(documentVersions.id, s.versionId))
  owner = await connect(s.owner.id)
  viewer = await connect(s.viewer.id)
  const [org] = await listOrganisations(s.deps.db, s.actors.owner)
  const elsewhere = await createShow(s.deps.db, s.actors.owner, {
    organisationId: org.id,
    title: 'Elsewhere',
  })
  scoped = await connect(s.owner.id, [elsewhere.id])
  const priv = await createExportRecord(s.deps.db, s.deps.blobs, s.actors.viewer, {
    id: newId(),
    showId: s.show.id,
    kind: 'pdf-script',
    filename: 'mine.pdf',
    layerSelection: [{ kind: 'personal', id: s.viewer.id }],
    file: Readable.from(Buffer.from(librettoBytes())),
  })
  privateId = priv.id
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

describe('export_marked_script', () => {
  test('stores a PDF and returns a resource link that reads back as application/pdf', async () => {
    const res = await callTool(owner, 'export_marked_script', {
      documentId: s.docId,
      layers: 'all',
    })
    expect(res.isError).toBeFalsy()
    const { record, uri } = res.structuredContent as Json
    expect(uri).toBe(uriOf(record.id))
    expect(record).toMatchObject({ kind: 'pdf-script', showId: s.show.id, privateTo: null })
    const link = res.content.find((c) => c.type === 'resource_link')
    expect(link).toMatchObject({ type: 'resource_link', uri, mimeType: 'application/pdf' })
    expect(link?.name).toBe(record.filename)

    const read = await owner.readResource({ uri })
    const [content] = read.contents as Json[]
    expect(content.mimeType).toBe('application/pdf')
    const bytes = Buffer.from(content.blob, 'base64')
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    // The record is on the show's list for everyone.
    const listed = await callTool(viewer, 'list_exports', { showId: s.show.id })
    expect((listed.structuredContent as Json).items.map((r: Json) => r.id)).toContain(record.id)
  })

  test('layers take department codes, "personal" and layer keys; an unknown department is invalid', async () => {
    const ok = await callTool(viewer, 'export_marked_script', {
      documentId: s.docId,
      layers: ['LX', 'personal'],
    })
    expect(ok.isError).toBeFalsy()
    const { record } = ok.structuredContent as Json
    expect(record.privateTo).toBe(s.viewer.id)
    expect(record.layerSelection).toEqual([
      { kind: 'department', id: s.depts.LX.id },
      { kind: 'personal', id: s.viewer.id },
    ])
    const bad = await callTool(owner, 'export_marked_script', {
      documentId: s.docId,
      layers: ['NOPE'],
    })
    expect(bad.isError).toBe(true)
    expect(resultText(bad)).toMatch(/invalid/)
  })

  test('pages and paper make the subset PDF, record the options, and name the file in slug form', async () => {
    const res = await callTool(owner, 'export_marked_script', {
      documentId: s.docId,
      layers: 'none',
      pages: '2–3',
      paper: 'Letter',
      includeStandbyWarn: false,
      includeCueNotes: false,
    })
    expect(res.isError).toBeFalsy()
    const { record, uri } = res.structuredContent as Json
    expect(record.options).toEqual({
      pages: '2-3',
      paper: 'Letter',
      includeStandbyWarn: false,
      includeAnnotations: true,
      includeCueNotes: false,
    })
    expect(record.filename).toBe('show-libretto-v1-clean.pdf')
    const read = await owner.readResource({ uri })
    const [content] = read.contents as Json[]
    const out = await PDFDocument.load(Buffer.from(content.blob, 'base64'))
    expect(out.getPageCount()).toBe(2)
    expect(out.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
    // list_exports carries the options.
    const listed = await callTool(owner, 'list_exports', { showId: s.show.id })
    const row = (listed.structuredContent as Json).items.find((r: Json) => r.id === record.id)
    expect(row.options).toEqual(record.options)
  })

  test('without options the pages and paper are untouched, and a custom file name is used', async () => {
    const res = await callTool(owner, 'export_marked_script', {
      documentId: s.docId,
      layers: 'none',
      filename: 'whole script',
    })
    expect(res.isError).toBeFalsy()
    const { record, uri } = res.structuredContent as Json
    expect(record.filename).toBe('whole script.pdf')
    expect(record.options).toMatchObject({ pages: 'all' })
    expect(record.options.paper).toBeUndefined()
    const [content] = (await owner.readResource({ uri })).contents as Json[]
    const out = await PDFDocument.load(Buffer.from(content.blob, 'base64'))
    const src = await PDFDocument.load(librettoBytes())
    expect(out.getPageCount()).toBe(src.getPageCount())
    expect(out.getPage(0).getSize()).toEqual(src.getPage(0).getSize())
  })

  test('a range past the end, a bad range and an unsafe file name are invalid', async () => {
    for (const args of [{ pages: '1-9999' }, { pages: 'x' }, { filename: 'a/b' }]) {
      const res = await callTool(owner, 'export_marked_script', {
        documentId: s.docId,
        layers: 'none',
        ...args,
      })
      expect([JSON.stringify(args), res.isError]).toEqual([JSON.stringify(args), true])
      expect(resultText(res)).toMatch(/invalid/)
    }
  })

  test("another show's token is forbidden", async () => {
    const res = await callTool(scoped, 'export_marked_script', {
      documentId: s.docId,
      layers: 'none',
    })
    expect(res.isError).toBe(true)
    expect(resultText(res)).toMatch(/forbidden/)
  })
})

describe('export resources', () => {
  test("another member's token cannot read a private export through the resource", async () => {
    await expect(owner.readResource({ uri: uriOf(privateId) })).rejects.toThrow(/not found/i)
    const own = await viewer.readResource({ uri: uriOf(privateId) })
    expect((own.contents as Json[])[0].mimeType).toBe('application/pdf')
  })

  test('a missing export, and an export addressed through the wrong show, are not found', async () => {
    await expect(owner.readResource({ uri: uriOf(newId()) })).rejects.toThrow(/not found/i)
    await expect(
      owner.readResource({ uri: `binder://shows/${newId()}/exports/${privateId}` }),
    ).rejects.toThrow(/not found/i)
  })

  test('list_exports hides private exports of others', async () => {
    const mine = await callTool(viewer, 'list_exports', { showId: s.show.id })
    expect((mine.structuredContent as Json).items.map((r: Json) => r.id)).toContain(privateId)
    const theirs = await callTool(owner, 'list_exports', { showId: s.show.id })
    expect((theirs.structuredContent as Json).items.map((r: Json) => r.id)).not.toContain(privateId)
    expect(
      (await listExportRecords(s.deps.db, s.actors.owner, { showId: s.show.id })).map((r) => r.id),
    ).not.toContain(privateId)
  })

  test('a scoped token cannot list exports of another show', async () => {
    const res = await callTool(scoped, 'list_exports', { showId: s.show.id })
    expect(res.isError).toBe(true)
    expect(resultText(res)).toMatch(/forbidden/)
  })
})
