import { changeLog } from '@binder/db'
import { type Actor, newId } from '@binder/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import {
  activityFeed,
  createAnnotation,
  createCue,
  createShow,
  latestChangePerShow,
  listDepartments,
  listOrganisations,
  updateCue,
  updateShow,
} from '../src/services'
import { asJson } from './documentHelpers'
import { anchorAt, setupMarkupShow } from './markupHelpers'

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>

const asAgent = (a: Actor, agent: string): Actor => ({ ...a, via: 'mcp', agent })

const newCue = (s: Setup, actor: Actor, dept: 'LX' | 'SND' | 'TM', label = 'c') =>
  createCue(s.deps.db, actor, { showId: s.show.id, departmentId: s.depts[dept].id, label })

/** A log row written directly, for shapes no service produces. */
const logRow = (s: Setup, over: Partial<typeof changeLog.$inferInsert> = {}) =>
  s.deps.db.insert(changeLog).values({
    showId: s.show.id,
    userId: s.owner.id,
    via: 'web',
    batchId: newId(),
    tableName: 'cues',
    rowId: newId(),
    op: 'delete',
    before: { label: 'x' },
    after: null,
    layer: null,
    ...over,
  })

describe('latestChangePerShow', () => {
  test('last change is the newest visible batch per show', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    // an older run by the editor, then three relabels in one batch by the owner
    const a = await newCue(s, s.actors.editorLx, 'LX', 'A')
    const cues = [
      a,
      await newCue(s, s.actors.owner, 'LX', 'B'),
      await newCue(s, s.actors.owner, 'LX', 'C'),
    ]
    const batchId = newId()
    for (const c of cues) {
      await updateCue(db, s.actors.owner, { cueId: c.id, patch: { label: `${c.label}2` }, batchId })
    }
    const second = await createShow(db, s.ownerActor, {
      organisationId: (await listOrganisations(db, s.ownerActor))[0].id,
      title: 'Second',
    })
    const [dept] = await listDepartments(db, s.ownerActor, { showId: second.id })
    await createCue(db, s.ownerActor, { showId: second.id, departmentId: dept.id, label: 'only' })

    const last = await latestChangePerShow(db, s.actors.owner)
    expect(Object.keys(last).sort()).toEqual([s.show.id, second.id].sort())
    expect(last[s.show.id]).toMatchObject({
      userId: s.owner.id,
      label: 'Olive',
      summary: 'relabelled 3 LX cues',
      sentence: 'LX relabelled 3 cues',
      count: 3,
      via: 'web',
      agent: null,
      batchId,
    })
    expect(last[second.id]).toMatchObject({ sentence: expect.stringMatching(/cue$/), count: 1 })
    expect(Date.parse(last[s.show.id]?.at ?? '')).not.toBeNaN()
  })

  test('the wording is the activity feed wording, with the agent named', async () => {
    const s = await setupMarkupShow()
    const claude = asAgent(s.actors.owner, 'claude-code/2.1.76 (cli)')
    const batchId = newId()
    for (const label of ['a', 'b']) {
      await createCue(s.deps.db, claude, {
        showId: s.show.id,
        departmentId: s.depts.SND.id,
        label,
        batchId,
      })
    }
    const feed = await activityFeed(s.deps.db, s.actors.owner, { showId: s.show.id, limit: 1 })
    const last = (await latestChangePerShow(s.deps.db, s.actors.owner))[s.show.id]
    expect(last).toMatchObject({
      label: feed.groups[0].label,
      summary: feed.groups[0].summary,
      at: feed.groups[0].at,
      count: feed.groups[0].count,
      via: 'mcp',
      agent: 'claude-code/2.1.76 (cli)',
    })
    expect(last?.label).toBe('Olive via Claude Code')
    expect(last?.sentence).toBe('SND added 2 cues')
  })

  test("last change ignores another member's personal-layer edits", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    await newCue(s, s.actors.owner, 'LX', 'visible')
    await createAnnotation(db, s.actors.editor, {
      showId: s.show.id,
      layerKind: 'personal',
      layerId: s.editor.id,
      anchor: anchorAt(s.docId, s.versionId, 0),
      type: 'note',
      geometry: {},
      text: 'private',
      style: {},
    })
    // the owner never sees the editor's private note as the last change ...
    const forOwner = (await latestChangePerShow(db, s.actors.owner))[s.show.id]
    expect(forOwner).toMatchObject({ userId: s.owner.id, sentence: 'LX added 1 cue' })
    // ... but the editor, whose layer it is, does
    const forEditor = (await latestChangePerShow(db, s.actors.editor))[s.show.id]
    expect(forEditor).toMatchObject({ userId: s.editor.id, summary: 'added 1 annotation' })
  })

  test('last change for a null-batch row stands alone', async () => {
    const s = await setupMarkupShow()
    await newCue(s, s.actors.owner, 'LX')
    await logRow(s, { batchId: null, tableName: 'cues', layer: `department:${s.depts.TM.id}` })
    await logRow(s, { batchId: null, tableName: 'cues', layer: `department:${s.depts.TM.id}` })
    const last = (await latestChangePerShow(s.deps.db, s.actors.owner))[s.show.id]
    expect(last).toMatchObject({ batchId: null, count: 1, sentence: 'TM deleted 1 cue' })
  })

  test('a run is read for its batch and user only, even when another batch interleaves', async () => {
    const s = await setupMarkupShow()
    const batchId = newId()
    const dept = { layer: `department:${s.depts.LX.id}` }
    await logRow(s, { batchId, ...dept })
    await logRow(s, { batchId: newId(), userId: s.editor.id, ...dept })
    await logRow(s, { batchId, ...dept })
    await logRow(s, { batchId, userId: s.editor.id, ...dept }) // same batch id, another user
    const last = (await latestChangePerShow(s.deps.db, s.actors.owner))[s.show.id]
    expect(last).toMatchObject({ userId: s.editor.id, batchId, count: 1 })
  })

  test('show without changes is null', async () => {
    const s = await setupMarkupShow()
    await s.deps.db.delete(changeLog).where(eq(changeLog.showId, s.show.id))
    expect(await latestChangePerShow(s.deps.db, s.actors.owner)).toEqual({ [s.show.id]: null })
  })

  test('a show whose only row is another member private one is null for the others', async () => {
    const s = await setupMarkupShow()
    await s.deps.db.delete(changeLog).where(eq(changeLog.showId, s.show.id))
    await logRow(s, { layer: `personal:${s.editor.id}` })
    expect((await latestChangePerShow(s.deps.db, s.actors.owner))[s.show.id]).toBeNull()
    expect((await latestChangePerShow(s.deps.db, s.actors.editor))[s.show.id]).not.toBeNull()
  })

  test('sentence for a revision upload is "revision uploaded"', async () => {
    const s = await setupMarkupShow()
    await logRow(s, {
      tableName: 'document_versions',
      op: 'insert',
      before: null,
      after: { versionNumber: 2 },
    })
    const last = (await latestChangePerShow(s.deps.db, s.actors.owner))[s.show.id]
    expect(last).toMatchObject({ sentence: 'revision uploaded', summary: 'uploaded 1 revision' })
  })

  test('a first version uploaded with its document reads "document uploaded"', async () => {
    const s = await setupMarkupShow()
    const batchId = newId()
    await logRow(s, {
      batchId,
      tableName: 'documents',
      op: 'insert',
      before: null,
      after: { title: 'Score' },
    })
    await logRow(s, {
      batchId,
      tableName: 'document_versions',
      op: 'insert',
      before: null,
      after: { versionNumber: 1 },
    })
    const last = (await latestChangePerShow(s.deps.db, s.actors.owner))[s.show.id]
    expect(last).toMatchObject({ sentence: 'document uploaded', count: 2 })
  })

  test('mixed groups fall back to the feed sentence', async () => {
    const s = await setupMarkupShow()
    const batchId = newId()
    await newCue(s, s.actors.owner, 'LX')
    for (const code of ['LX', 'SND'] as const) {
      await createCue(s.deps.db, s.actors.owner, {
        showId: s.show.id,
        departmentId: s.depts[code].id,
        label: 'm',
        batchId,
      })
    }
    const last = (await latestChangePerShow(s.deps.db, s.actors.owner))[s.show.id]
    expect(last?.sentence).toBe('added 1 LX cue; added 1 SND cue')
  })

  test('archived shows, non-member shows and shows outside the token scope are left out', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const org = (await listOrganisations(db, s.ownerActor))[0]
    const archived = await createShow(db, s.ownerActor, { organisationId: org.id, title: 'Old' })
    await updateShow(db, s.ownerActor, { showId: archived.id, patch: { status: 'archived' } })
    const out = await latestChangePerShow(db, s.actors.owner)
    expect(Object.keys(out)).toEqual([s.show.id])
    // a non-member sees nothing at all
    const outsider: Actor = { userId: s.outsider.id, via: 'web', agent: null }
    expect(await latestChangePerShow(db, outsider)).toEqual({})
    // a token scoped to some other show sees nothing of this one
    expect(await latestChangePerShow(db, { ...s.actors.owner, showScope: [archived.id] })).toEqual(
      {},
    )
    expect(
      Object.keys(await latestChangePerShow(db, { ...s.actors.owner, showScope: [s.show.id] })),
    ).toEqual([s.show.id])
  })

  test('GET /api/me/shows/last-changes needs a session and returns { shows }', async () => {
    const s = await setupMarkupShow()
    await newCue(s, s.actors.owner, 'LX')
    const anon = await s.app.request('/api/me/shows/last-changes')
    expect(anon.status).toBe(401)
    const res = asJson(
      await s.app.request('/api/me/shows/last-changes', { headers: { cookie: s.owner.cookie } }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.shows[s.show.id]).toMatchObject({
      sentence: 'LX added 1 cue',
      label: 'Olive',
      userId: s.owner.id,
    })
    const outsider = asJson(
      await s.app.request('/api/me/shows/last-changes', { headers: { cookie: s.outsider.cookie } }),
    )
    expect(await outsider.json()).toEqual({ shows: {} })
  })
})
