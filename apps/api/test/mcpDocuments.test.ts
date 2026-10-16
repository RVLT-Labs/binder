import { Readable } from 'node:stream'
import { documents, documentVersions } from '@binder/db'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { markVersionFailed } from '../src/processing/documentJob'
import { addDocumentVersion, createDocument, createToken } from '../src/services'
import { librettoBytes, setupShow } from './documentHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'

type Setup = Awaited<ReturnType<typeof setupShow>>
let s: Setup
let owner: Client
let editor: Client
let viewer: Client
const clients: Client[] = []
const actorOf = (userId: string) => ({ userId, via: 'web' as const, agent: null })

async function connect(userId: string) {
  const { token } = await createToken(s.deps.db, actorOf(userId), { name: 't', showScope: '*' })
  const c = await connectMcp(s.app, token)
  clients.push(c)
  return c
}

beforeAll(async () => {
  s = await setupShow()
  owner = await connect(s.owner.id)
  editor = await connect(s.editor.id)
  viewer = await connect(s.viewer.id)
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

const upload = (title: string) =>
  createDocument(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
    showId: s.show.id,
    kind: 'libretto',
    title,
    file: Readable.from([librettoBytes()]),
  })

const fail = (
  id: string,
  code: 'unknown' | 'timeout' | 'low_resolution',
  dpi: number | null = null,
) => markVersionFailed(s.deps.db, id, 'boom', code, dpi)

const versionRow = async (id: string) =>
  (await s.deps.db.select().from(documentVersions).where(eq(documentVersions.id, id)))[0]

describe('the processing-control tools', () => {
  test('are listed with accurate hints', async () => {
    const { tools } = await owner.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))
    for (const name of ['cancel_version_processing', 'retry_version', 'remove_version']) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(false)
    }
    expect(byName.get('remove_version')?.annotations?.destructiveHint).toBe(true)
    expect(byName.get('cancel_version_processing')?.annotations?.destructiveHint).toBe(false)
    expect(byName.get('retry_version')?.annotations?.destructiveHint).toBe(false)
    const schema = byName.get('remove_version')?.inputSchema as { properties?: object } | undefined
    expect(schema?.properties).toHaveProperty('confirm')
  })

  test('the three tools work', async () => {
    const { version } = await upload('three tools')

    const cancelled = await callTool(owner, 'cancel_version_processing', { versionId: version.id })
    expect(cancelled.isError).toBeFalsy()
    expect(cancelled.structuredContent).toMatchObject({
      id: version.id,
      status: 'failed',
      failureCode: 'cancelled',
    })

    const before = s.jobs.enqueued.length
    const retried = await callTool(editor, 'retry_version', { versionId: version.id })
    expect(retried.isError).toBeFalsy()
    expect(retried.structuredContent).toMatchObject({
      id: version.id,
      status: 'queued',
      failureCode: null,
    })
    expect(s.jobs.enqueued.slice(before)).toEqual([version.id])

    await fail(version.id, 'unknown')
    const another = await upload('v2 present')
    await addDocumentVersion(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
      documentId: another.document.id,
      label: 'second',
      file: Readable.from([librettoBytes()]),
    })
    // The failed v1 of a document that has a second version needs no confirmation.
    await fail(another.version.id, 'timeout')
    const removed = await callTool(owner, 'remove_version', { versionId: another.version.id })
    expect(removed.isError).toBeFalsy()
    expect(removed.structuredContent).toEqual({
      removed: {
        versionId: another.version.id,
        documentId: another.document.id,
        documentRemoved: false,
      },
    })
    expect(await versionRow(another.version.id)).toBeUndefined()
  })

  test('remove_version needs confirm for a whole-document delete', async () => {
    const { document, version } = await upload('only version')
    await fail(version.id, 'unknown')

    const asked = await callTool(owner, 'remove_version', { versionId: version.id })
    expect(asked.isError).toBe(true)
    expect(resultText(asked)).toMatch(/^CONFIRMATION_REQUIRED: .*only version of "only version"/)
    expect(asked.structuredContent).toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(await versionRow(version.id)).toBeDefined()

    const refused = await callTool(owner, 'remove_version', {
      versionId: version.id,
      confirm: false,
    })
    expect(refused.structuredContent).toMatchObject({ code: 'CONFIRMATION_REQUIRED' })

    const done = await callTool(owner, 'remove_version', { versionId: version.id, confirm: true })
    expect(done.isError).toBeFalsy()
    expect(done.structuredContent).toEqual({
      removed: { versionId: version.id, documentId: document.id, documentRemoved: true },
    })
    expect(await versionRow(version.id)).toBeUndefined()
    expect(
      await s.deps.db.select().from(documents).where(eq(documents.id, document.id)),
    ).toHaveLength(0)
  })

  test('a viewer is told forbidden, never asked to confirm', async () => {
    const { version } = await upload('viewer')
    await fail(version.id, 'unknown')
    for (const [tool, args] of [
      ['cancel_version_processing', {}],
      ['retry_version', {}],
      ['remove_version', {}],
    ] as const) {
      const res = await callTool(viewer, tool, { versionId: version.id, ...args })
      expect(res.isError, tool).toBe(true)
      expect(resultText(res), tool).toMatch(/^forbidden:/)
    }
    expect(await versionRow(version.id)).toBeDefined()
  })

  test('a state conflict comes back as a readable tool error', async () => {
    const { version } = await upload('ready one')
    await s.deps.db
      .update(documentVersions)
      .set({ status: 'ready' })
      .where(eq(documentVersions.id, version.id))
    const res = await callTool(owner, 'cancel_version_processing', { versionId: version.id })
    expect(res.isError).toBe(true)
    expect(resultText(res)).toBe('conflict: This upload has already finished')
    const noConfirmNeeded = await callTool(owner, 'remove_version', { versionId: version.id })
    expect(resultText(noConfirmNeeded)).toBe('conflict: Only a failed upload can be removed')
  })

  test('list_documents shows failureCode and size', async () => {
    const low = await upload('scan')
    await fail(low.version.id, 'low_resolution', 72)
    const queued = await upload('queued')

    const listed = await callTool(owner, 'list_documents', { showId: s.show.id })
    const docs = listed.structuredContent?.documents as Array<{
      id: string
      versions: Array<Record<string, unknown>>
    }>
    const failed = docs.find((d) => d.id === low.document.id)?.versions[0]
    expect(failed).toMatchObject({
      status: 'failed',
      failureCode: 'low_resolution',
      failureMessage: expect.stringContaining('72 dpi'),
      originalSizeBytes: librettoBytes().length,
    })
    const waiting = docs.find((d) => d.id === queued.document.id)?.versions[0]
    expect(waiting).toMatchObject({
      status: 'queued',
      failureCode: null,
      failureMessage: null,
      originalSizeBytes: librettoBytes().length,
    })

    const got = await callTool(owner, 'get_document', { documentId: low.document.id })
    expect(got.structuredContent?.versions[0]).toMatchObject({ failureCode: 'low_resolution' })
    expect(got.structuredContent?.version).toMatchObject({ failureCode: 'low_resolution' })
  })
})
