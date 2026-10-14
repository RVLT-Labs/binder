import { changeLog } from '@binder/db'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createAnnotation, createToken, listAnnotations } from '../src/services'
import { anchorAt, setupMarkupShow } from './markupHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>
let s: Setup
let owner: Client
let lx: Client
let viewer: Client
const clients: Client[] = []

async function connect(userId: string, name = 'test-client') {
  const actor = { userId, via: 'web' as const, agent: null }
  const { token } = await createToken(s.deps.db, actor, { name: 't', showScope: '*' })
  const c = await connectMcp(s.app, token, { name, version: '1.0.0' })
  clients.push(c)
  return c
}

const place = (pageIndex = 1, x = 120, y = 500) => ({
  documentId: s.docId,
  pageIndex,
  x,
  y,
})

beforeAll(async () => {
  s = await setupMarkupShow()
  owner = await connect(s.owner.id, 'claude-desktop')
  lx = await connect(s.editorLx.id)
  viewer = await connect(s.viewer.id)
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

describe('annotation tools', () => {
  test('create_annotation on layer "personal"; list_annotations and get_annotation with another member\'s token never show it', async () => {
    const made = await callTool(viewer, 'create_annotation', {
      showId: s.show.id,
      layer: 'personal',
      type: 'note',
      text: 'my private note',
      anchor: place(2),
    })
    expect(made.isError).toBeFalsy()
    expect(made.structuredContent).toMatchObject({
      layerKind: 'personal',
      layerId: s.viewer.id,
      layer: `personal:${s.viewer.id}`,
      type: 'note',
      text: 'my private note',
      geometry: {},
      anchor: { documentVersionId: s.versionId, pageIndex: 2, x: 120, y: 500, status: 'ok' },
    })
    const id = made.structuredContent?.id

    // The owner and an editor see the show's annotations but never the viewer's personal one.
    for (const other of [owner, lx]) {
      const listed = await callTool(other, 'list_annotations', { showId: s.show.id })
      expect(listed.isError).toBeFalsy()
      expect(JSON.stringify(listed.structuredContent)).not.toContain(id)
      const got = await callTool(other, 'get_annotation', { annotationId: id })
      expect(got.isError).toBe(true)
      expect(resultText(got)).toMatch(/^not_found:/)
      const asked = await callTool(other, 'list_annotations', {
        showId: s.show.id,
        layer: `personal:${s.viewer.id}`,
      })
      expect(resultText(asked)).toMatch(/^not_found:/)
      const edited = await callTool(other, 'update_annotation', { annotationId: id, text: 'x' })
      expect(resultText(edited)).toMatch(/^not_found:/)
      const removed = await callTool(other, 'delete_annotations', { annotationIds: [id] })
      expect(resultText(removed)).toMatch(/^not_found:/)
    }
    // The viewer reads it back, by default and by the 'personal' shorthand.
    const mine = await callTool(viewer, 'list_annotations', {
      showId: s.show.id,
      layer: 'personal',
    })
    expect(mine.structuredContent?.items.map((a: { id: string }) => a.id)).toEqual([id])
    const all = await callTool(viewer, 'list_annotations', { showId: s.show.id })
    expect(all.structuredContent?.items.map((a: { id: string }) => a.id)).toContain(id)
    const got = await callTool(viewer, 'get_annotation', { annotationId: id })
    expect(got.structuredContent).toMatchObject({ id, text: 'my private note' })
  })

  test('create_annotation on a department by code or id; geometry, style, and the stamp and highlight rules', async () => {
    const rect = await callTool(lx, 'create_annotation', {
      showId: s.show.id,
      layer: 'lx',
      type: 'rect',
      anchor: place(),
      geometry: { w: 150, h: 40 },
      style: { colour: '#112233', strokeWidth: 2 },
    })
    expect(rect.isError).toBeFalsy()
    expect(rect.structuredContent).toMatchObject({
      layerKind: 'department',
      layerId: s.depts.LX.id,
      layer: `department:${s.depts.LX.id}`,
      geometry: { w: 150, h: 40 },
      style: { colour: '#112233', strokeWidth: 2 },
    })
    const byId = await callTool(lx, 'create_annotation', {
      showId: s.show.id,
      layer: s.depts.LX.id,
      type: 'stamp',
      text: 'Fly in',
      anchor: place(),
    })
    expect(byId.structuredContent).toMatchObject({ type: 'stamp', text: 'Fly in' })
    const highlight = await callTool(lx, 'create_annotation', {
      showId: s.show.id,
      layer: 'LX',
      type: 'highlight',
      anchor: { ...place(), text: { quote: 'to be or', wordStart: 4, wordEnd: 6 } },
    })
    expect(highlight.structuredContent?.anchor).toMatchObject({
      text: { quote: 'to be or', wordStart: 4, wordEnd: 6 },
    })

    // Invalid: rect without geometry, highlight without a quote, empty note, unknown layer.
    for (const bad of [
      { type: 'rect' },
      { type: 'highlight' },
      { type: 'note', text: '' },
      { type: 'arrow', geometry: { dx: 0, dy: 0 } },
      { type: 'note', text: 'x', layer: 'ZZZ' },
    ]) {
      const r = await callTool(lx, 'create_annotation', {
        showId: s.show.id,
        layer: 'LX',
        anchor: place(),
        ...bad,
      })
      expect(r.isError, JSON.stringify(bad)).toBe(true)
      expect(resultText(r), JSON.stringify(bad)).toMatch(/^invalid:/)
    }
  })

  test('permissions: the LX editor cannot draw on SND and a viewer cannot draw on a department', async () => {
    const onSnd = await callTool(lx, 'create_annotation', {
      showId: s.show.id,
      layer: 'SND',
      type: 'note',
      text: 'x',
      anchor: place(),
    })
    expect(resultText(onSnd)).toMatch(/^forbidden:/)
    const viewerLx = await callTool(viewer, 'create_annotation', {
      showId: s.show.id,
      layer: 'LX',
      type: 'note',
      text: 'x',
      anchor: place(),
    })
    expect(resultText(viewerLx)).toMatch(/^forbidden:/)
    // Another user's personal layer, by key.
    const theirs = await callTool(owner, 'create_annotation', {
      showId: s.show.id,
      layer: `personal:${s.viewer.id}`,
      type: 'note',
      text: 'x',
      anchor: place(),
    })
    expect(resultText(theirs)).toMatch(/^forbidden:/)
  })

  test('update_annotation changes fields, moves between layers, and validates the whole row', async () => {
    const made = await callTool(lx, 'create_annotation', {
      showId: s.show.id,
      layer: 'LX',
      type: 'arrow',
      anchor: place(3, 10, 20),
      geometry: { dx: 40, dy: -10 },
    })
    const id = made.structuredContent?.id
    const moved = await callTool(lx, 'update_annotation', {
      annotationId: id,
      geometry: { dx: -40, dy: 10 },
      anchor: place(4, 11, 21),
      style: { colour: '#FF0000' },
    })
    expect(moved.structuredContent).toMatchObject({
      geometry: { dx: -40, dy: 10 },
      anchor: { pageIndex: 4, x: 11, y: 21, documentVersionId: s.versionId },
      style: { colour: '#FF0000' },
    })
    const bad = await callTool(lx, 'update_annotation', {
      annotationId: id,
      geometry: { dx: 0, dy: 0 },
    })
    expect(resultText(bad)).toMatch(/^invalid:/)
    const retyped = await callTool(lx, 'update_annotation', { annotationId: id, type: 'rect' })
    expect(resultText(retyped)).toMatch(/^invalid:/)
    const toSnd = await callTool(lx, 'update_annotation', { annotationId: id, layer: 'SND' })
    expect(resultText(toSnd)).toMatch(/^forbidden:/)
    const toPersonal = await callTool(lx, 'update_annotation', {
      annotationId: id,
      layer: 'personal',
    })
    expect(toPersonal.structuredContent).toMatchObject({
      layerKind: 'personal',
      layerId: s.editorLx.id,
    })
    const back = await callTool(lx, 'update_annotation', { annotationId: id, layer: 'LX' })
    expect(back.structuredContent).toMatchObject({
      layerKind: 'department',
      layerId: s.depts.LX.id,
    })
  })

  test('list_annotations filters by layer and document and paginates', async () => {
    const lxEditor = s.actors.editorLx
    for (let i = 0; i < 3; i++) {
      await createAnnotation(s.deps.db, lxEditor, {
        showId: s.show.id,
        layerKind: 'department',
        layerId: s.depts.LX.id,
        anchor: anchorAt(s.docId, s.versionId, 5 + i),
        type: 'note',
        geometry: {},
        text: `page ${5 + i}`,
        style: {},
      })
    }
    const onLx = await callTool(owner, 'list_annotations', { showId: s.show.id, layer: 'LX' })
    const ids = onLx.structuredContent?.items.map((a: { id: string }) => a.id)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    const expected = (
      await listAnnotations(s.deps.db, s.actors.owner, {
        showId: s.show.id,
        layer: { kind: 'department', id: s.depts.LX.id },
      })
    ).map((a) => a.id)
    expect(ids).toEqual(expected)
    const keyed = await callTool(owner, 'list_annotations', {
      showId: s.show.id,
      layer: `department:${s.depts.LX.id}`,
      documentId: s.docId,
    })
    expect(keyed.structuredContent?.items.map((a: { id: string }) => a.id)).toEqual(expected)
    const noDoc = await callTool(owner, 'list_annotations', {
      showId: s.show.id,
      documentId: 'nope',
    })
    expect(noDoc.structuredContent?.items).toEqual([])
    const page1 = await callTool(owner, 'list_annotations', {
      showId: s.show.id,
      layer: 'LX',
      limit: 2,
    })
    expect(page1.structuredContent?.items).toHaveLength(2)
    expect(page1.structuredContent?.nextCursor).toBe('2')
    const page2 = await callTool(owner, 'list_annotations', {
      showId: s.show.id,
      layer: 'LX',
      limit: 2,
      cursor: page1.structuredContent?.nextCursor,
    })
    expect(page2.structuredContent?.items[0].id).toBe(expected[2])
    const unknown = await callTool(owner, 'list_annotations', { showId: s.show.id, layer: 'ZZZ' })
    expect(resultText(unknown)).toMatch(/^invalid:/)
  })

  test('delete_annotations over ten needs confirm', async () => {
    const ids: string[] = []
    for (let i = 0; i < 11; i++) {
      const a = await createAnnotation(s.deps.db, s.actors.owner, {
        showId: s.show.id,
        layerKind: 'department',
        layerId: i % 2 ? s.depts.VID.id : s.depts.SM.id,
        anchor: anchorAt(s.docId, s.versionId, 10),
        type: 'note',
        geometry: {},
        text: `n${i}`,
        style: {},
      })
      ids.push(a.id)
    }
    const count = async () =>
      (await listAnnotations(s.deps.db, s.actors.owner, { showId: s.show.id })).length
    const before = await count()
    const asked = await callTool(owner, 'delete_annotations', { annotationIds: ids })
    expect(asked.isError).toBe(true)
    expect(asked.structuredContent).toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(resultText(asked)).toMatch(
      /^CONFIRMATION_REQUIRED: .*11 annotations.*SM.*VID.* Call again with confirm: true to proceed\.$/,
    )
    expect(await count()).toBe(before)

    const done = await callTool(owner, 'delete_annotations', { annotationIds: ids, confirm: true })
    expect(done.isError).toBeFalsy()
    expect(done.structuredContent?.deleted).toHaveLength(11)
    expect(await count()).toBe(before - 11)

    // Ten or fewer need none.
    const one = await createAnnotation(s.deps.db, s.actors.owner, {
      showId: s.show.id,
      layerKind: 'department',
      layerId: s.depts.SM.id,
      anchor: anchorAt(s.docId, s.versionId, 10),
      type: 'note',
      geometry: {},
      text: 'x',
      style: {},
    })
    const quick = await callTool(owner, 'delete_annotations', { annotationIds: [one.id] })
    expect(quick.structuredContent?.deleted).toEqual([one.id])
  })

  test('an eleven-id delete that includes a hidden personal annotation fails not_found without revealing it', async () => {
    const mine = await createAnnotation(s.deps.db, s.actors.viewer, {
      showId: s.show.id,
      layerKind: 'personal',
      layerId: s.viewer.id,
      anchor: anchorAt(s.docId, s.versionId, 10),
      type: 'note',
      geometry: {},
      text: 'private',
      style: {},
    })
    const ids = [mine.id, ...Array.from({ length: 10 }, () => crypto.randomUUID())]
    const r = await callTool(owner, 'delete_annotations', { annotationIds: ids })
    expect(resultText(r)).toMatch(/^not_found:/)
    expect(r.structuredContent?.code).not.toBe('CONFIRMATION_REQUIRED')
  })

  test('annotation writes through MCP log via mcp with the client name as agent and the layer key', async () => {
    const made = await callTool(owner, 'create_annotation', {
      showId: s.show.id,
      layer: 'personal',
      type: 'note',
      text: 'logged',
      anchor: place(),
    })
    const rows = await s.deps.db
      .select()
      .from(changeLog)
      .where(eq(changeLog.rowId, made.structuredContent?.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ via: 'mcp', tableName: 'annotations', op: 'insert' })
    expect(rows[0].agent).toMatch(/claude-desktop/)
    expect(rows[0].layer).toBe(`personal:${s.owner.id}`)
  })
})
