import { createReadStream } from 'node:fs'
import { changeLog } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import type { Client } from '@modelcontextprotocol/client'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { pageImageBlobKey } from '../src/blob/keys'
import { TOOL_NAMES } from '../src/mcp/registry'
import { jpegSize } from '../src/processing/jpeg'
import {
  createCue,
  createDocument,
  createShow,
  createToken,
  listDepartments,
  listOrganisations,
} from '../src/services'
import { type Json, setupShow } from './documentHelpers'
import { RecordingJobs } from './helpers'
import { callTool, connectMcp } from './mcpHelpers'
import { missingTools, processVersion } from './processingHelpers'
import { skipWithoutTools } from './tools'

const skipPages = skipWithoutTools('MCP processed-page tests', missingTools)

type Setup = Awaited<ReturnType<typeof setupShow>>
let s: Setup
let showB: { id: string }
let allToken: string
let scopedToken: string
let versionId: string
const clients: Client[] = []

const MCP_URL = 'http://localhost/mcp'

async function connect(token: string, era: 'legacy' | 'auto' = 'legacy'): Promise<Client> {
  const client = await connectMcp(s.app, token, undefined, era)
  clients.push(client)
  return client
}

const call = callTool

const errorText = (r: { content: Json[] }) => r.content.map((c) => c.text ?? '').join('\n')

beforeAll(async () => {
  s = await setupShow()
  const [org] = await listOrganisations(s.deps.db, s.ownerActor)
  showB = await createShow(s.deps.db, s.ownerActor, { organisationId: org.id, title: 'Show B' })
  allToken = (await createToken(s.deps.db, s.ownerActor, { name: 'all', showScope: '*' })).token
  scopedToken = (
    await createToken(s.deps.db, s.ownerActor, { name: 'scoped', showScope: [s.show.id] })
  ).token

  const { version } = await createDocument(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
    showId: s.show.id,
    kind: 'libretto',
    title: 'Libretto',
    file: createReadStream(FIXTURES.librettoPdf),
  })
  versionId = version.id
  if (!skipPages) {
    const deps = { db: s.deps.db, blobs: s.deps.blobs, jobs: new RecordingJobs() }
    await processVersion(deps, version.id)
  }
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

describe('mcp endpoint', () => {
  test('a missing bearer token is 401 with WWW-Authenticate', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    for (const authorization of [undefined, 'Bearer bnd_not-a-real-token']) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        host: 'localhost',
      }
      if (authorization) headers.authorization = authorization
      const res = await s.app.fetch(new Request(MCP_URL, { method: 'POST', headers, body }))
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toMatch(/^Bearer\b/)
    }
  })

  test('GET and DELETE are 405 on the stateless endpoint', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await s.app.fetch(
        new Request(MCP_URL, {
          method,
          headers: {
            authorization: `Bearer ${allToken}`,
            accept: 'text/event-stream',
            host: 'localhost',
          },
        }),
      )
      expect(res.status).toBe(405)
    }
  })

  test('a foreign Host header is refused', async () => {
    const res = await s.app.fetch(
      new Request(MCP_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${allToken}`,
          'content-type': 'application/json',
          host: 'evil.example',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe.each(['legacy', 'auto'] as const)('%s protocol era', (era) => {
  describe('mcp tools', () => {
    test('listTools returns the M0 tools with annotations', async () => {
      const client = await connect(allToken, era)
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())
      for (const tool of tools) {
        expect(tool.description, tool.name).toBeTruthy()
        expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean')
        expect(tool.inputSchema.type).toBe('object')
      }
      const byName = new Map(tools.map((t) => [t.name, t]))
      expect(byName.get('list_shows')?.annotations?.readOnlyHint).toBe(true)
      expect(byName.get('get_page')?.annotations?.readOnlyHint).toBe(true)
      expect(byName.get('create_show')?.annotations?.readOnlyHint).toBe(false)
      expect(byName.get('upload_document')?.description).toContain('-F file=@script.pdf')
    })

    test('list_shows and get_show respect token show scope', async () => {
      const all = await connect(allToken, era)
      const listed = await call(all, 'list_shows', {})
      const allIds = listed.structuredContent.active.map((x: Json) => x.id)
      expect(allIds).toEqual(expect.arrayContaining([s.show.id, showB.id]))

      const scoped = await connect(scopedToken, era)
      const scopedList = await call(scoped, 'list_shows', {})
      expect(scopedList.structuredContent.active.map((x: Json) => x.id)).toEqual([s.show.id])

      const own = await call(scoped, 'get_show', { showId: s.show.id })
      expect(own.isError).toBeFalsy()
      expect(own.structuredContent).toMatchObject({ id: s.show.id, role: 'owner', memberCount: 3 })

      const other = await call(scoped, 'get_show', { showId: showB.id })
      expect(other.isError).toBe(true)
      expect(errorText(other)).toMatch(/forbidden/)
    })

    test('list_shows includes lastChange and inNow', async () => {
      const [dept] = await listDepartments(s.deps.db, s.ownerActor, { showId: s.show.id })
      await createCue(s.deps.db, s.ownerActor, {
        showId: s.show.id,
        departmentId: dept.id,
        label: 'pulse',
      })
      const connId = `mcp-${era}`
      s.deps.presence.join(s.show.id, {
        id: connId,
        userId: s.editor.id,
        name: 'Ed',
        send: () => {},
        close: () => {},
      })
      try {
        const client = await connect(allToken, era)
        const listed = await call(client, 'list_shows', {})
        const mine = listed.structuredContent.active.find((x: Json) => x.id === s.show.id)
        expect(mine.inNow).toEqual([{ userId: s.editor.id, name: 'Ed', departments: [] }])
        expect(mine.lastChange).toMatchObject({
          userId: s.owner.id,
          sentence: expect.stringMatching(/cue$/),
          at: expect.any(String),
        })
        const quiet = listed.structuredContent.active.find((x: Json) => x.id === showB.id)
        expect(quiet.inNow).toEqual([])
        expect(quiet.lastChange === null || typeof quiet.lastChange === 'object').toBe(true)
      } finally {
        s.deps.presence.leave(s.show.id, connId)
      }
    })

    test('invalid arguments come back as a tool error', async () => {
      const client = await connect(allToken, era)
      const res = await call(client, 'get_page', { versionId, index: 0, maxPx: 5000 })
      expect(res.isError).toBe(true)
    })

    test('create_show via MCP logs via=mcp with the client name as agent', async () => {
      const client = await connect(allToken, era)
      const res = await call(client, 'create_show', { title: `Made by an agent (${era})` })
      expect(res.isError).toBeFalsy()
      const rows = await s.deps.db
        .select()
        .from(changeLog)
        .where(
          and(eq(changeLog.showId, res.structuredContent.id), eq(changeLog.tableName, 'shows')),
        )
      expect(rows).toHaveLength(1)
      expect(rows[0].via).toBe('mcp')
      expect(rows[0].agent).toMatch(/test-client/)
      // 2026-07-28 clients declare themselves on every request; stateless 2025-era requests do
      // not, so the User-Agent stands in.
      expect(rows[0].agent).toBe(era === 'auto' ? 'test-client/1.0.0' : 'test-client/1.0')
    })

    test('list_documents and get_document return ids and page summaries', async () => {
      const client = await connect(allToken, era)
      const listed = await call(client, 'list_documents', { showId: s.show.id })
      const doc = listed.structuredContent.documents.find((d: Json) => d.title === 'Libretto')
      expect(doc.versions[0].id).toBe(versionId)

      const got = await call(client, 'get_document', { documentId: doc.id })
      expect(got.structuredContent.version.id).toBe(versionId)
      expect(Array.isArray(got.structuredContent.version.pages)).toBe(true)
    })

    test('upload_document refuses loopback and file: URLs', async () => {
      const client = await connect(allToken, era)
      const loopback = await call(client, 'upload_document', {
        showId: s.show.id,
        kind: 'libretto',
        url: 'http://127.0.0.1:9/script.pdf',
      })
      expect(loopback.isError).toBe(true)
      expect(errorText(loopback)).toMatch(/private or reserved/)

      const localhost = await call(client, 'upload_document', {
        showId: s.show.id,
        kind: 'libretto',
        url: 'http://localhost:9/script.pdf',
      })
      expect(localhost.isError).toBe(true)
      expect(errorText(localhost)).toMatch(/private or reserved/)

      const file = await call(client, 'upload_document', {
        showId: s.show.id,
        kind: 'libretto',
        url: `file://${FIXTURES.librettoPdf}`,
      })
      expect(file.isError).toBe(true)
      expect(errorText(file)).toMatch(/Only http and https/)
    })

    describe.skipIf(skipPages)('processed pages', () => {
      test('get_page returns an image block and the word layer for the processed libretto', async () => {
        const client = await connect(allToken, era)
        const res = await call(client, 'get_page', { versionId, index: 0 })
        expect(res.isError).toBeFalsy()
        const image = res.content.find((c) => c.type === 'image')
        expect(image.mimeType).toBe('image/jpeg')
        const size = jpegSize(Buffer.from(image.data, 'base64'))
        expect(Math.max(size.width, size.height)).toBe(1600)
        expect(res.structuredContent.image).toEqual(size)
        expect(res.structuredContent.words.length).toBeGreaterThan(0)
        expect(res.structuredContent.words[0]).toHaveLength(5)
        expect(res.structuredContent.text).toContain('PIRATES')

        const [doc] = (await call(client, 'list_documents', { showId: s.show.id }))
          .structuredContent.documents
        const key = pageImageBlobKey(s.show.id, doc.id, versionId, 0, 1600)
        expect(await s.deps.blobs.exists(key)).toBe(true)

        const wordsOnly = await call(client, 'get_page', {
          versionId,
          index: 0,
          includeImage: false,
        })
        expect(wordsOnly.content.some((c) => c.type === 'image')).toBe(false)
      })

      test('search_script finds PIRATES on page 1', async () => {
        const client = await connect(allToken, era)
        const res = await call(client, 'search_script', { versionId, query: 'pirates' })
        expect(res.isError).toBeFalsy()
        const [hit] = res.structuredContent.hits
        expect(hit.pageIndex).toBe(0)
        expect(hit.snippet).toMatch(/PIRATES/)
        expect(hit.box.w).toBeGreaterThan(0)
      })

      test('a token scoped to another show cannot read pages', async () => {
        const otherToken = (
          await createToken(s.deps.db, s.ownerActor, { name: 'b', showScope: [showB.id] })
        ).token
        const client = await connect(otherToken, era)
        const res = await call(client, 'get_page', { versionId, index: 0, includeImage: false })
        expect(res.isError).toBe(true)
        expect(errorText(res)).toMatch(/forbidden/)
      })

      test('page resources serve words and the image', async () => {
        const client = await connect(allToken, era)
        const base = `binder://shows/${s.show.id}/versions/${versionId}/pages/0`
        const words = await client.readResource({ uri: `${base}/words` })
        const [wordsContent] = words.contents as Json[]
        expect(wordsContent.mimeType).toBe('application/json')
        expect(JSON.parse(wordsContent.text).words.length).toBeGreaterThan(0)

        const image = await client.readResource({ uri: `${base}/image` })
        const [imageContent] = image.contents as Json[]
        expect(imageContent.mimeType).toBe('image/jpeg')
        expect(jpegSize(Buffer.from(imageContent.blob, 'base64')).width).toBeGreaterThan(0)

        await expect(
          client.readResource({
            uri: `binder://shows/${showB.id}/versions/${versionId}/pages/0/words`,
          }),
        ).rejects.toThrow(/not found/i)
      })
    })
  })

  describe('mcp resources', () => {
    test('guides resource lists three guides and reads one', async () => {
      const client = await connect(allToken, era)
      const { resources } = await client.listResources()
      const guides = resources.filter((r) => r.uri.startsWith('binder://guides/')).map((r) => r.uri)
      expect(guides.sort()).toEqual([
        'binder://guides/jayden-style',
        'binder://guides/mic-and-dca-practice',
        'binder://guides/tmix-format',
      ])
      const read = await client.readResource({ uri: 'binder://guides/tmix-format' })
      const [content] = read.contents as Json[]
      expect(content.mimeType).toBe('text/markdown')
      expect(content.text).toMatch(/SQLite/)
      expect(content.text.startsWith('---')).toBe(false)

      await expect(client.readResource({ uri: 'binder://guides/nope' })).rejects.toThrow()
    })
  })
})
