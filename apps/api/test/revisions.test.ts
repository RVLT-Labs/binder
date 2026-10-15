import { createReadStream } from 'node:fs'
import { annotations, changeLog, cues } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import { type Actor, type Anchor, newId, type ReviewItem, type SyncCrudEntry } from '@binder/shared'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, test } from 'vitest'
import { AppError } from '../src/errors'
import { REANCHOR_AGENT } from '../src/processing/reanchorJob'
import {
  compareDocumentVersions,
  createDocument,
  createShow,
  createToken,
  listOrganisations,
  listReanchorReview,
  listVersionAnchors,
  resolveReanchorItem,
  updateShow,
} from '../src/services'
import { logChange } from '../src/services/changeLog'
import { applyCrudBatch } from '../src/sync/apply'
import { asJson, type Json } from './documentHelpers'
import { APP_ORIGIN } from './helpers'
import { missingTools } from './processingHelpers'
import { buildRevisedFixture, type RevisedFixture } from './revisionsHelpers'
import { skipWithoutTools } from './tools'

const skip = skipWithoutTools('revisions tests', missingTools)

let F: RevisedFixture
const db = () => F.s.deps.db
const blobs = () => F.s.deps.blobs
const actors = () => F.s.actors

beforeAll(async () => {
  if (skip) return
  F = await buildRevisedFixture()
}, 900_000)

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

const review = (actor: Actor) => listReanchorReview(db(), actor, { documentId: F.docId })
const resolve = (
  actor: Actor,
  table: 'cues' | 'annotations',
  rowId: string,
  action: 'accept' | 'revert' | 'reanchor',
) => resolveReanchorItem(db(), blobs(), actor, { table, rowId, action })
const idsOf = (items: Array<{ rowId: string }>) => items.map((i) => i.rowId)
const find = (items: ReviewItem[], rowId: string) => items.find((i) => i.rowId === rowId)

const logsOf = (rowId: string) =>
  db().select().from(changeLog).where(eq(changeLog.rowId, rowId)).orderBy(changeLog.seq)
const cueAnchor = async (id: string) =>
  (await db().select().from(cues).where(eq(cues.id, id)))[0]?.anchor as Anchor
const noteAnchor = async (id: string) =>
  (await db().select().from(annotations).where(eq(annotations.id, id)))[0]?.anchor as Anchor

describe.skipIf(skip)('the re-anchoring review list', () => {
  test('lists what the run could not place, with the anchor it had before and a readable title', async () => {
    const { pending, olderVersions, currentVersionId } = await review(actors().owner)
    expect(currentVersionId).toBe(F.v2)
    expect(olderVersions).toEqual([])

    const cue = find(pending, F.rows.cueAccept.id)
    expect(cue).toMatchObject({
      table: 'cues',
      layer: `department:${F.s.depts.LX.id}`,
      title: 'LX 12 · Accept me',
      anchor: { documentVersionId: F.v2, status: 'unresolved' },
    })
    expect(cue?.previous).toEqual(F.cutLine)

    const noteItem = find(pending, F.rows.deptNote.id)
    expect(noteItem).toMatchObject({ table: 'annotations', title: 'note · Fly out early please' })
    expect(noteItem?.previous).toEqual(F.cutLine)
    // a highlight is titled by its quote
    const quoteWords = F.cutLine.text?.quote.split(/\s+/).slice(0, 6).join(' ')
    expect(find(pending, F.rows.highlight.id)?.title.startsWith(`highlight · ${quoteWords}`)).toBe(
      true,
    )

    // placed cleanly (ok) and unplaced rows are not pending
    expect(idsOf(pending)).not.toContain(F.rows.cueKept.id)
    expect(idsOf(pending)).not.toContain(F.rows.cueUnplaced.id)
    expect(pending.every((i) => i.anchor.documentVersionId === F.v2)).toBe(true)
    expect(pending.every((i) => i.anchor.status !== 'ok')).toBe(true)
  })

  test('items are grouped by layer (department order, personal last), then reading order', async () => {
    const { pending } = await review(actors().owner)
    const layers = pending.map((i) => i.layer)
    // contiguous groups
    const groups = layers.filter((l, i) => l !== layers[i - 1])
    expect(new Set(groups).size).toBe(groups.length)
    expect(groups).toEqual([
      `department:${F.s.depts.LX.id}`,
      `department:${F.s.depts.SND.id}`,
      `personal:${F.s.owner.id}`,
    ])
    // reading order within each layer
    for (const layer of groups) {
      const inLayer = pending.filter((i) => i.layer === layer)
      for (const [i, item] of inLayer.entries()) {
        const prev = inLayer[i - 1]
        if (!prev) continue
        const key = (a: Anchor) => a.pageIndex * 100000 - a.y
        expect(key(prev.anchor)).toBeLessThanOrEqual(key(item.anchor))
      }
    }
  })

  test("the review list never includes another user's personal annotation", async () => {
    const owner = await review(actors().owner)
    const everything = [...owner.pending, ...owner.olderVersions]
    expect(idsOf(everything)).not.toContain(F.rows.viewerNote.id)
    expect(idsOf(everything)).toContain(F.rows.ownerNote.id)
    expect(JSON.stringify(owner)).not.toContain(F.rows.viewerNote.id)
    expect(JSON.stringify(owner)).not.toContain(`personal:${F.s.viewer.id}`)

    const viewer = await review(actors().viewer)
    const seen = [...viewer.pending, ...viewer.olderVersions]
    expect(idsOf(seen)).toContain(F.rows.viewerNote.id)
    expect(idsOf(seen)).not.toContain(F.rows.ownerNote.id)
    expect(JSON.stringify(viewer)).not.toContain(F.rows.ownerNote.id)
    // the department layers are the same for everyone
    expect(idsOf(viewer.pending)).toContain(F.rows.cueAccept.id)
  })

  test('a non-member gets not_found, a token outside the show forbidden', async () => {
    const outsider: Actor = { userId: F.s.outsider.id, via: 'web', agent: null }
    expect(await code(review(outsider))).toBe('not_found')
    expect(await code(review({ ...actors().owner, showScope: [newId()] }))).toBe('forbidden')
    expect(await code(listReanchorReview(db(), actors().owner, { documentId: newId() }))).toBe(
      'not_found',
    )
  })

  test('a cue placed on v1 by an offline client after the switch is listed under olderVersions and "reanchor" moves it to v2', async () => {
    const id = newId()
    const editorSync: Actor = { ...actors().editor, via: 'sync' }
    const entry: SyncCrudEntry = {
      table: 'cues',
      id,
      op: 'PUT',
      data: {
        show_id: F.s.show.id,
        department_id: F.s.depts.LX.id,
        major: 31,
        minor: 0,
        label: 'Placed offline',
        anchor: JSON.stringify(F.keptLine),
        type: 'go',
        notes: '',
        colour: null,
      },
    }
    const result = await applyCrudBatch(db(), editorSync, {
      batchId: `${F.s.editor.id}:off-1`,
      entries: [entry],
    })
    expect(result).toEqual({ applied: 1, rejected: [] })

    const before = await review(actors().editor)
    const item = find(before.olderVersions, id)
    expect(item).toMatchObject({ title: 'LX 31 · Placed offline', previous: null })
    expect(item?.anchor.documentVersionId).toBe(F.v1)
    expect(idsOf(before.pending)).not.toContain(id)

    // nothing moved it, so there is nothing to revert to
    expect(await code(resolve(actors().editor, 'cues', id, 'revert'))).toBe('invalid')

    const a = await resolve(actors().editor, 'cues', id, 'reanchor')
    expect(a.documentVersionId).toBe(F.v2)
    expect(a.status).toBe('ok')
    expect(a.text?.quote).toBe(F.keptLine.text?.quote)
    expect(await cueAnchor(id)).toEqual(a)
    expect(idsOf((await review(actors().editor)).olderVersions)).not.toContain(id)

    // the move is an ordinary logged write by the editor
    const last = (await logsOf(id)).at(-1)
    expect(last).toMatchObject({ op: 'update', via: 'web', agent: null, userId: F.s.editor.id })
    expect(last?.before).toMatchObject({ anchor: { documentVersionId: F.v1 } })
    expect(last?.after).toMatchObject({ anchor: { documentVersionId: F.v2 } })
  })
})

describe.skipIf(skip)('resolving a review item', () => {
  test('accept sets status ok through the cue service, leaves previous alone, and is logged as the actor', async () => {
    const id = F.rows.cueAccept.id
    const a = await resolve(actors().owner, 'cues', id, 'accept')
    expect(a).toMatchObject({
      documentVersionId: F.v2,
      status: 'ok',
      pageIndex: F.cutLine.pageIndex,
    })
    expect(await cueAnchor(id)).toEqual(a)

    const { pending } = await review(actors().owner)
    expect(idsOf(pending)).not.toContain(id)

    const last = (await logsOf(id)).at(-1)
    expect(last).toMatchObject({ via: 'web', agent: null, userId: F.s.owner.id, op: 'update' })
    expect(last?.after).toEqual({ anchor: a })

    // The accept is a later edit by a person: `previous` is still the anchor before the run, so a
    // revert restores that and not the unresolved v2 anchor the accept replaced.
    expect(await resolve(actors().owner, 'cues', id, 'revert')).toEqual(F.cutLine)
    expect(find((await review(actors().owner)).olderVersions, id)?.previous).toEqual(F.cutLine)
  })

  test('revert restores the v1 anchor, which leaves the row on the older version', async () => {
    const id = F.rows.cueRevert.id
    const a = await resolve(actors().owner, 'cues', id, 'revert')
    expect(a).toEqual(F.cutLine)
    expect(await cueAnchor(id)).toEqual(F.cutLine)

    const r = await review(actors().owner)
    expect(idsOf(r.pending)).not.toContain(id)
    expect(find(r.olderVersions, id)).toMatchObject({ anchor: F.cutLine, previous: F.cutLine })

    // reverting again changes nothing and writes nothing
    const logs = (await logsOf(id)).length
    expect(await resolve(actors().owner, 'cues', id, 'revert')).toEqual(F.cutLine)
    expect((await logsOf(id)).length).toBe(logs)
  })

  test('reanchor on an item still on an older version moves it to the current one; on a current one it is a no-op', async () => {
    const id = F.rows.cueReanchor.id
    await resolve(actors().owner, 'cues', id, 'revert')
    expect((await cueAnchor(id)).documentVersionId).toBe(F.v1)

    const a = await resolve(actors().owner, 'cues', id, 'reanchor')
    // the line is cut from v2, so it cannot be found there
    expect(a).toMatchObject({ documentVersionId: F.v2, status: 'unresolved' })

    // already on the current version: returns its anchor, writes nothing
    const logs = (await logsOf(id)).length
    expect(await resolve(actors().owner, 'cues', id, 'reanchor')).toEqual(a)
    expect((await logsOf(id)).length).toBe(logs)
  })

  test('an unbound highlight can be accepted: it stays unbound and validates', async () => {
    const id = F.rows.highlight.id
    const before = await noteAnchor(id)
    expect(before).toMatchObject({ documentVersionId: F.v2, status: 'unresolved' })
    expect(before.text).toMatchObject({ wordStart: -1, wordEnd: -1 })

    const a = await resolve(actors().owner, 'annotations', id, 'accept')
    expect(a.status).toBe('ok')
    expect(a.text).toMatchObject({ wordStart: -1, wordEnd: -1 })
    expect(await noteAnchor(id)).toEqual(a)
    expect(idsOf((await review(actors().owner)).pending)).not.toContain(id)
  })

  test('layer rights apply: a viewer or an editor outside the department is refused, and nothing is written', async () => {
    const sndCue = F.rows.cueSnd.id
    const logs = (await logsOf(sndCue)).length
    expect(await code(resolve(actors().viewer, 'cues', sndCue, 'accept'))).toBe('forbidden')
    expect(await code(resolve(actors().editorLx, 'cues', sndCue, 'accept'))).toBe('forbidden')
    expect(await code(resolve(actors().editorLx, 'cues', sndCue, 'revert'))).toBe('forbidden')
    expect(await code(resolve(actors().editorLx, 'cues', sndCue, 'reanchor'))).toBe('forbidden')
    expect((await logsOf(sndCue)).length).toBe(logs)
    expect((await cueAnchor(sndCue)).status).toBe('unresolved')

    // in scope it works; a viewer cannot touch a department annotation either
    expect(await code(resolve(actors().viewer, 'annotations', F.rows.deptNote.id, 'accept'))).toBe(
      'forbidden',
    )
    expect(
      (await resolve(actors().editorLx, 'cues', F.rows.cueKept.id, 'accept')).documentVersionId,
    ).toBe(F.v2)
  })

  test("another user's personal annotation is not_found, for members and non-members alike", async () => {
    const id = F.rows.viewerNote.id
    const outsider: Actor = { userId: F.s.outsider.id, via: 'web', agent: null }
    for (const actor of [actors().owner, actors().editor, outsider]) {
      for (const action of ['accept', 'revert', 'reanchor'] as const) {
        expect(await code(resolve(actor, 'annotations', id, action))).toBe('not_found')
      }
    }
    // the owner of the note can resolve it
    expect((await resolve(actors().viewer, 'annotations', id, 'accept')).status).toBe('ok')
    // an unknown row and a malformed request
    expect(await code(resolve(actors().owner, 'cues', newId(), 'accept'))).toBe('not_found')
    expect(await code(resolve(actors().owner, 'cues', F.rows.cueUnplaced.id, 'accept'))).toBe(
      'invalid',
    )
    expect(await code(resolve(actors().owner, 'cues', 'a\u0000b', 'accept'))).toBe('invalid')
    expect(
      await code(
        resolveReanchorItem(db(), blobs(), actors().owner, {
          table: 'cues',
          rowId: F.rows.cueKept.id,
          // biome-ignore lint/suspicious/noExplicitAny: a deliberately wrong action
          action: 'delete' as any,
        }),
      ),
    ).toBe('invalid')
  })

  test("only a re-anchoring run's rows define previous: the run's agent string from another channel does not", async () => {
    const id = F.rows.cueForge.id
    const forged: Anchor = { ...F.cutLine, pageIndex: 99, x: 1, y: 1 }
    // newer than the run's row and carrying its agent, but sent through MCP: not a server-authored run
    await logChange(db(), {
      showId: F.s.show.id,
      actor: { userId: F.s.owner.id, via: 'mcp', agent: REANCHOR_AGENT },
      batchId: newId(),
      table: 'cues',
      rowId: id,
      op: 'update',
      before: { anchor: forged },
      after: { anchor: await cueAnchor(id) },
      layer: `department:${F.s.depts.LX.id}`,
    })
    const item = find((await review(actors().owner)).pending, id)
    expect(item?.previous).toEqual(F.cutLine)
    expect(await resolve(actors().owner, 'cues', id, 'revert')).toEqual(F.cutLine)
  })
})

describe.skipIf(skip)('version anchors', () => {
  test("listVersionAnchors(v1) returns the anchors as they were on v1, without others' personal rows", async () => {
    const owner = await listVersionAnchors(db(), actors().owner, { versionId: F.v1 })
    const byId = new Map(owner.map((r) => [r.rowId, r]))
    expect(byId.get(F.rows.cueSnd.id)).toMatchObject({
      table: 'cues',
      layer: `department:${F.s.depts.SND.id}`,
      anchor: F.cutLine,
    })
    expect(byId.get(F.rows.deptNote.id)?.anchor).toEqual(F.cutLine)
    expect(byId.get(F.rows.ownerNote.id)?.anchor).toEqual(F.cutLine)
    expect(byId.has(F.rows.cueUnplaced.id)).toBe(false)
    // another member's personal note, and its past anchors, never appear
    expect(byId.has(F.rows.viewerNote.id)).toBe(false)
    expect(JSON.stringify(owner)).not.toContain(F.rows.viewerNote.id)
    expect(JSON.stringify(owner)).not.toContain(`personal:${F.s.viewer.id}`)
    // history written while the note was another member's personal annotation stays theirs
    expect(byId.has(F.rows.movedNote.id)).toBe(false)

    const viewer = await listVersionAnchors(db(), actors().viewer, { versionId: F.v1 })
    expect(viewer.find((r) => r.rowId === F.rows.viewerNote.id)?.anchor).toEqual(F.cutLine)
    expect(viewer.map((r) => r.rowId)).not.toContain(F.rows.ownerNote.id)

    const editor = await listVersionAnchors(db(), actors().editor, { versionId: F.v1 })
    expect(editor.find((r) => r.rowId === F.rows.movedNote.id)?.anchor).toEqual(F.cutLine)
  })

  test('a row on the requested version answers with its current anchor; v2 lists the moved rows', async () => {
    const v2 = await listVersionAnchors(db(), actors().owner, { versionId: F.v2 })
    const kept = v2.find((r) => r.rowId === F.rows.cueKept.id)
    expect(kept).toBeDefined()
    expect(kept?.anchor.documentVersionId).toBe(F.v2)
    // the row's v2 anchor is the live one, even though it has been through two versions
    expect(kept?.anchor).toEqual(await cueAnchor(F.rows.cueKept.id))
    expect(v2.map((r) => r.rowId)).not.toContain(F.rows.viewerNote.id)
  })

  test('grouped by layer then reading order', async () => {
    const rows = await listVersionAnchors(db(), actors().owner, { versionId: F.v1 })
    const layers = rows.map((r) => r.layer)
    const groups = layers.filter((l, i) => l !== layers[i - 1])
    expect(new Set(groups).size).toBe(groups.length)
    expect(groups.at(-1)).toBe(`personal:${F.s.owner.id}`)
  })

  test('non-members get not_found, out-of-scope tokens forbidden, unknown versions not_found', async () => {
    const outsider: Actor = { userId: F.s.outsider.id, via: 'web', agent: null }
    expect(await code(listVersionAnchors(db(), outsider, { versionId: F.v1 }))).toBe('not_found')
    expect(
      await code(
        listVersionAnchors(db(), { ...actors().owner, showScope: [newId()] }, { versionId: F.v1 }),
      ),
    ).toBe('forbidden')
    expect(await code(listVersionAnchors(db(), actors().owner, { versionId: newId() }))).toBe(
      'not_found',
    )
  })
})

describe.skipIf(skip)('comparing versions', () => {
  test('compare reports the cut lines as removed', async () => {
    const r = await compareDocumentVersions(db(), blobs(), actors().viewer, {
      fromVersionId: F.v1,
      toVersionId: F.v2,
      limit: 10000,
    })
    expect(r.removed).toBeGreaterThan(0)
    expect(r.removed).toBeGreaterThan(r.added)
    const removed = r.entries.filter((e) => e.op === 'removed')
    expect(removed.length).toBe(r.removed)
    expect(r.entries.filter((e) => e.op === 'added').length).toBe(r.added)
    const lead = (F.cutLine.text?.quote ?? '').toLowerCase().split(/\s+/).slice(0, 2).join(' ')
    expect(removed.some((e) => e.text.toLowerCase().includes(lead))).toBe(true)
  })

  test('entries are capped at limit (default 2000, at most 10000) and truncated says so', async () => {
    const small = await compareDocumentVersions(db(), blobs(), actors().owner, {
      fromVersionId: F.v1,
      toVersionId: F.v2,
      limit: 5,
    })
    expect(small.entries).toHaveLength(5)
    expect(small.truncated).toBe(true)
    // totals describe the whole diff, not the part returned
    const full = await compareDocumentVersions(db(), blobs(), actors().owner, {
      fromVersionId: F.v1,
      toVersionId: F.v2,
      limit: 10000,
    })
    expect(small.removed).toBe(full.removed)
    expect(small.added).toBe(full.added)
    const dflt = await compareDocumentVersions(db(), blobs(), actors().owner, {
      fromVersionId: F.v1,
      toVersionId: F.v2,
    })
    expect(dflt.entries.length).toBe(Math.min(2000, full.entries.length))
    expect(dflt.truncated).toBe(full.entries.length > 2000)
    // identical versions: every line is `same`
    const same = await compareDocumentVersions(db(), blobs(), actors().owner, {
      fromVersionId: F.v2,
      toVersionId: F.v2,
      limit: 10000,
    })
    expect(same.added + same.removed).toBe(0)

    const bad = (limit: number) =>
      code(
        compareDocumentVersions(db(), blobs(), actors().owner, {
          fromVersionId: F.v1,
          toVersionId: F.v2,
          limit,
        }),
      )
    expect(await bad(0)).toBe('invalid')
    expect(await bad(1.5)).toBe('invalid')
    // above the maximum is capped at it
    const huge = await compareDocumentVersions(db(), blobs(), actors().owner, {
      fromVersionId: F.v1,
      toVersionId: F.v2,
      limit: 1_000_000,
    })
    expect(huge.entries.length).toBeLessThanOrEqual(10000)
  })

  test('versions of different documents are invalid; non-members get not_found; tokens out of scope forbidden', async () => {
    const other = await createDocument(db(), blobs(), F.s.jobs, actors().owner, {
      showId: F.s.show.id,
      kind: 'libretto',
      title: 'Other',
      file: createReadStream(FIXTURES.librettoPdf),
    })
    expect(
      await code(
        compareDocumentVersions(db(), blobs(), actors().owner, {
          fromVersionId: F.v1,
          toVersionId: other.version.id,
        }),
      ),
    ).toBe('invalid')
    const outsider: Actor = { userId: F.s.outsider.id, via: 'web', agent: null }
    const input = { fromVersionId: F.v1, toVersionId: F.v2 }
    expect(await code(compareDocumentVersions(db(), blobs(), outsider, input))).toBe('not_found')
    expect(
      await code(
        compareDocumentVersions(db(), blobs(), { ...actors().owner, showScope: [newId()] }, input),
      ),
    ).toBe('forbidden')
    expect(
      await code(
        compareDocumentVersions(db(), blobs(), actors().owner, {
          fromVersionId: newId(),
          toVersionId: F.v2,
        }),
      ),
    ).toBe('not_found')
  })
})

describe.skipIf(skip)('routes', () => {
  const api = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const { cookie, ...rest } = init
    return F.s.app.request(`/api${path}`, {
      ...rest,
      headers: {
        cookie: cookie ?? F.s.owner.cookie,
        origin: APP_ORIGIN,
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
    })
  }

  test('GET review, POST review, GET anchors and GET compare answer, and refuse non-members and anonymous callers', async () => {
    const got = asJson(await api(`/documents/${F.docId}/review`))
    expect(got.status).toBe(200)
    const body: Json = await got.json()
    expect(body.currentVersionId).toBe(F.v2)
    expect(body.pending.length).toBeGreaterThan(0)
    expect(JSON.stringify(body)).not.toContain(F.rows.viewerNote.id)

    // POST: resolve one (the cue was reverted onto v1 earlier; reanchor moves it back)
    const posted = asJson(
      await api(`/documents/${F.docId}/review`, {
        method: 'POST',
        body: JSON.stringify({ table: 'cues', rowId: F.rows.cueRevert.id, action: 'reanchor' }),
      }),
    )
    expect(posted.status).toBe(200)
    expect(((await posted.json()) as Json).anchor.documentVersionId).toBe(F.v2)

    // a row of another document, or a bad body, is refused
    expect(
      (
        await api(`/documents/${newId()}/review`, {
          method: 'POST',
          body: JSON.stringify({ table: 'cues', rowId: F.rows.cueRevert.id, action: 'accept' }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await api(`/documents/${F.docId}/review`, {
          method: 'POST',
          body: JSON.stringify({ table: 'cues', rowId: F.rows.cueRevert.id, action: 'nuke' }),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api(`/documents/${F.docId}/review`, {
          method: 'POST',
          cookie: F.s.viewer.cookie,
          body: JSON.stringify({ table: 'cues', rowId: F.rows.cueSnd.id, action: 'accept' }),
        })
      ).status,
    ).toBe(403)

    const anchors = asJson(await api(`/versions/${F.v1}/anchors`))
    expect(anchors.status).toBe(200)
    const list = ((await anchors.json()) as Json).anchors as Array<{ rowId: string }>
    expect(list.map((r) => r.rowId)).toContain(F.rows.deptNote.id)
    expect(JSON.stringify(list)).not.toContain(F.rows.viewerNote.id)

    const compare = asJson(
      await api(`/documents/${F.docId}/compare?from=${F.v1}&to=${F.v2}&limit=20`),
    )
    expect(compare.status).toBe(200)
    const diff: Json = await compare.json()
    expect(diff.entries).toHaveLength(20)
    expect(diff.truncated).toBe(true)
    expect(diff.removed).toBeGreaterThan(0)
    expect((await api(`/documents/${F.docId}/compare?from=${F.v1}`)).status).toBe(400)
    expect(
      (await api(`/documents/${F.docId}/compare?from=${F.v1}&to=${F.v2}&limit=0`)).status,
    ).toBe(400)
    // the versions must belong to the document in the path
    expect((await api(`/documents/${newId()}/compare?from=${F.v1}&to=${F.v2}`)).status).toBe(404)

    for (const path of [
      `/documents/${F.docId}/review`,
      `/versions/${F.v1}/anchors`,
      `/documents/${F.docId}/compare?from=${F.v1}&to=${F.v2}`,
    ]) {
      expect((await api(path, { cookie: F.s.outsider.cookie })).status).toBe(404)
      expect((await F.s.app.request(`/api${path}`)).status).toBe(401)
    }

    // a token whose scope excludes the show is forbidden (R27)
    const [org] = await listOrganisations(db(), actors().owner)
    const elsewhere = await createShow(db(), actors().owner, {
      organisationId: org.id,
      title: 'Elsewhere',
    })
    const { token } = await createToken(db(), actors().owner, {
      name: 'elsewhere',
      showScope: [elsewhere.id],
    })
    const bearer = await F.s.app.request(`/api/documents/${F.docId}/review`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(bearer.status).toBe(403)
  })
})

describe.skipIf(skip)('archived shows', () => {
  test('are read-only for resolving, but the review list and version anchors still answer', async () => {
    const id = F.rows.cueSnd.id
    const logs = (await logsOf(id)).length
    await updateShow(db(), actors().owner, { showId: F.s.show.id, patch: { status: 'archived' } })
    expect(await code(resolve(actors().owner, 'cues', id, 'accept'))).toBe('forbidden')
    expect(await code(resolve(actors().owner, 'cues', id, 'revert'))).toBe('forbidden')
    expect((await logsOf(id)).length).toBe(logs)
    expect((await review(actors().owner)).pending.length).toBeGreaterThan(0)
    expect(
      (await listVersionAnchors(db(), actors().owner, { versionId: F.v1 })).length,
    ).toBeGreaterThan(0)
    await updateShow(db(), actors().owner, { showId: F.s.show.id, patch: { status: 'prep' } })
  })
})
