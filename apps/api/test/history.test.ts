import { changeLog } from '@binder/db'
import { type Actor, type AnnotationFields, newId, type SyncCrudEntry } from '@binder/shared'
import { and, eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { AppError } from '../src/errors'
import {
  activityFeed,
  createAnnotation,
  createCue,
  deleteCues,
  listHistory,
  updateAnnotation,
  updateCue,
  updateShow,
} from '../src/services'
import { APP_ORIGIN } from './helpers'
import { anchorAt, setupMarkupShow } from './markupHelpers'

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

const asAgent = (a: Actor, agent: string): Actor => ({ ...a, via: 'mcp', agent })
const BASE = Date.parse('2026-10-15T09:00:00.000Z')

/** Makes the timeline deterministic: the nth log row of the show is stamped n minutes after BASE. */
async function stampTimeline(s: Setup): Promise<number[]> {
  const rows = await s.deps.db
    .select({ seq: changeLog.seq })
    .from(changeLog)
    .where(eq(changeLog.showId, s.show.id))
    .orderBy(changeLog.seq)
  for (const [i, r] of rows.entries()) {
    await s.deps.db
      .update(changeLog)
      .set({ serverTs: new Date(BASE + i * 60_000) })
      .where(eq(changeLog.seq, r.seq))
  }
  return rows.map((r) => r.seq)
}

const personalNote = (s: Setup, userId: string, over: Partial<AnnotationFields> = {}) => ({
  showId: s.show.id,
  layerKind: 'personal' as const,
  layerId: userId,
  anchor: anchorAt(s.docId, s.versionId, 0),
  type: 'note' as const,
  geometry: {},
  text: 'private',
  style: {},
  ...over,
})

async function newCue(s: Setup, actor: Actor, dept: 'LX' | 'SND' | 'TM', over = {}) {
  return createCue(s.deps.db, actor, {
    showId: s.show.id,
    departmentId: s.depts[dept].id,
    label: 'c',
    ...over,
  })
}

describe('listHistory', () => {
  test('filters by row, table, layer, user, kind, and time, newest first, paginated by before', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const claude = asAgent(s.actors.owner, 'Claude Code/2.1.0')
    const a = await newCue(s, s.actors.owner, 'LX', { label: 'A' }) // 1 (after the 7 seeded departments)
    await updateCue(db, s.actors.owner, { cueId: a.id, patch: { label: 'A2' } })
    const b = await newCue(s, s.actors.editorLx, 'LX', { label: 'B' })
    const c = await newCue(s, claude, 'SND', { label: 'C' })
    const note = await createAnnotation(db, s.actors.owner, {
      showId: s.show.id,
      layerKind: 'department',
      layerId: s.depts.LX.id,
      anchor: anchorAt(s.docId, s.versionId, 0),
      type: 'note',
      geometry: {},
      text: 'dept note',
      style: {},
    })
    const seqs = await stampTimeline(s)
    const all = await listHistory(db, s.actors.owner, { showId: s.show.id })
    // newest first, with the user's display name from the auth user table
    expect(all.entries.map((e) => e.seq)).toEqual([...seqs].reverse())
    expect(all.nextBefore).toBeNull()
    expect(all.entries[0]).toMatchObject({
      table: 'annotations',
      rowId: note.id,
      op: 'insert',
      userName: 'Olive',
      via: 'web',
      agent: null,
      layer: `department:${s.depts.LX.id}`,
      before: null,
    })

    const byRow = await listHistory(db, s.actors.owner, { showId: s.show.id, rowId: a.id })
    expect(byRow.entries.map((e) => [e.op, e.after])).toEqual([
      ['update', { label: 'A2' }],
      ['insert', expect.objectContaining({ label: 'A' })],
    ])
    expect(byRow.entries[0].before).toEqual({ label: 'A' })

    const byTable = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      table: 'annotations',
    })
    expect(byTable.entries.map((e) => e.rowId)).toEqual([note.id])

    // the layer carries its department's own seeding insert as well as its cues
    const byLayer = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      layer: `department:${s.depts.SND.id}`,
    })
    expect(byLayer.entries.map((e) => [e.table, e.rowId])).toEqual([
      ['cues', c.id],
      ['departments', s.depts.SND.id],
    ])

    const byUser = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      table: 'cues',
      userId: s.editorLx.id,
    })
    expect(byUser.entries.map((e) => e.rowId)).toEqual([b.id])
    expect(byUser.entries[0].userName).toBe('Lex')

    const agent = await listHistory(db, s.actors.owner, { showId: s.show.id, kind: 'agent' })
    expect(agent.entries.map((e) => e.rowId)).toEqual([c.id])
    expect(agent.entries[0]).toMatchObject({ via: 'mcp', agent: 'Claude Code/2.1.0' })
    const human = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      table: 'cues',
      kind: 'human',
    })
    expect(human.entries.map((e) => e.rowId)).toEqual([b.id, a.id, a.id])
    const everyone = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      table: 'cues',
      kind: 'all',
    })
    expect(everyone.entries).toHaveLength(4)

    // time bounds are inclusive on both ends: the 5th..8th rows are minutes 4..7 after BASE
    const at = (minutes: number) => new Date(BASE + minutes * 60_000)
    const window = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      from: at(seqs.length - 3),
      to: at(seqs.length - 2),
    })
    expect(window.entries.map((e) => e.seq)).toEqual([seqs.at(-2), seqs.at(-3)])
    const since = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      from: at(seqs.length - 2),
    })
    expect(since.entries.map((e) => e.seq)).toEqual([seqs.at(-1), seqs.at(-2)])
    const until = await listHistory(db, s.actors.owner, { showId: s.show.id, to: at(0) })
    expect(until.entries.map((e) => e.seq)).toEqual([seqs[0]])

    // pagination: pages of 4 walk the whole log exactly once
    const seen: number[] = []
    let before: number | undefined
    let pages = 0
    do {
      const page = await listHistory(db, s.actors.owner, { showId: s.show.id, limit: 4, before })
      expect(page.entries.length).toBeLessThanOrEqual(4)
      seen.push(...page.entries.map((e) => e.seq))
      before = page.nextBefore ?? undefined
      pages++
    } while (before !== undefined)
    expect(seen).toEqual([...seqs].reverse())
    expect(pages).toBe(Math.ceil(seqs.length / 4))
  })

  test('limit defaults to 50, is capped at 200, and must be a positive integer', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    for (let i = 0; i < 52; i++) {
      await db.insert(changeLog).values({
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
      })
    }
    const first = await listHistory(db, s.actors.owner, { showId: s.show.id })
    expect(first.entries).toHaveLength(50)
    expect(first.nextBefore).toBe(first.entries[49].seq)
    const huge = await listHistory(db, s.actors.owner, { showId: s.show.id, limit: 10_000 })
    expect(huge.entries.length).toBeLessThanOrEqual(200)
    expect(huge.entries.length).toBeGreaterThan(52)
    for (const limit of [0, -1, 1.5]) {
      expect(await code(listHistory(db, s.actors.owner, { showId: s.show.id, limit }))).toBe(
        'invalid',
      )
    }
    expect(
      await code(listHistory(db, s.actors.owner, { showId: s.show.id, layer: 'nonsense' })),
    ).toBe('invalid')
    expect(
      await code(listHistory(db, s.actors.owner, { showId: s.show.id, rowId: 'a\u0000b' })),
    ).toBe('invalid')
  })

  test('viewer and above read; a non-member and an out-of-scope token cannot', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    await newCue(s, s.actors.owner, 'LX')
    for (const actor of [s.actors.viewer, s.actors.editor, s.actors.editorLx, s.actors.owner]) {
      expect((await listHistory(db, actor, { showId: s.show.id })).entries.length).toBeGreaterThan(
        0,
      )
      expect((await activityFeed(db, actor, { showId: s.show.id })).groups.length).toBeGreaterThan(
        0,
      )
    }
    const outsider: Actor = { userId: s.outsider.id, via: 'web', agent: null }
    expect(await code(listHistory(db, outsider, { showId: s.show.id }))).toBe('not_found')
    expect(await code(activityFeed(db, outsider, { showId: s.show.id }))).toBe('not_found')
    const scoped: Actor = {
      ...s.actors.owner,
      via: 'mcp',
      agent: 'x',
      showScope: ['some-other-show'],
    }
    // requireShowRole answers a token outside the show with forbidden (R27), as every service does
    expect(await code(listHistory(db, scoped, { showId: s.show.id }))).toBe('forbidden')
    expect(await code(activityFeed(db, scoped, { showId: s.show.id }))).toBe('forbidden')
  })

  test('history survives the deletion of the rows it describes', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cue = await newCue(s, s.actors.owner, 'LX', { label: 'gone soon' })
    await deleteCues(db, s.actors.owner, { cueIds: [cue.id] })
    const { entries } = await listHistory(db, s.actors.owner, { showId: s.show.id, rowId: cue.id })
    expect(entries.map((e) => e.op)).toEqual(['delete', 'insert'])
    expect(entries[0].before).toMatchObject({ label: 'gone soon' })
  })
})

describe('department moves', () => {
  test('a move logs one row on the destination layer; the source department history still shows the cue leaving', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const lxCue = await newCue(s, s.actors.owner, 'LX', { label: 'leaves' })
    const stays = await newCue(s, s.actors.owner, 'LX', { label: 'stays' })
    const sndCue = await newCue(s, s.actors.owner, 'SND', { label: 'snd only' })
    await updateCue(db, s.actors.owner, {
      cueId: lxCue.id,
      patch: { departmentId: s.depts.SND.id },
    })

    const moves = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.rowId, lxCue.id), eq(changeLog.op, 'update')))
    expect(moves).toHaveLength(1)
    expect(moves[0].layer).toBe(`department:${s.depts.SND.id}`)
    expect(moves[0].before).toEqual({ departmentId: s.depts.LX.id })

    const lx = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      table: 'cues',
      layer: `department:${s.depts.LX.id}`,
    })
    // the cue's creation on LX, the move away (tagged SND but matched on before.departmentId), and the other LX cue
    expect(lx.entries.map((e) => [e.rowId, e.op]).sort()).toEqual(
      [
        [lxCue.id, 'insert'],
        [lxCue.id, 'update'],
        [stays.id, 'insert'],
      ].sort(),
    )
    const snd = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      table: 'cues',
      layer: `department:${s.depts.SND.id}`,
    })
    expect(snd.entries.map((e) => [e.rowId, e.op]).sort()).toEqual(
      [
        [lxCue.id, 'update'],
        [sndCue.id, 'insert'],
      ].sort(),
    )
    const tm = await listHistory(db, s.actors.owner, {
      showId: s.show.id,
      table: 'cues',
      layer: `department:${s.depts.TM.id}`,
    })
    expect(tm.entries).toEqual([])

    const feed = await activityFeed(db, s.actors.owner, {
      showId: s.show.id,
      layer: `department:${s.depts.LX.id}`,
    })
    expect(feed.groups.some((g) => g.fromSeq <= moves[0].seq && moves[0].seq <= g.toSeq)).toBe(true)
  })
})

describe('personal layers are private in history', () => {
  test("another user's personal-layer rows never appear in history or the activity feed", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.viewer, {
      ...personalNote(s, s.viewer.id),
      batchId: 'note-batch',
    })
    await updateAnnotation(db, s.actors.viewer, {
      annotationId: note.id,
      patch: { text: 'edited privately' },
      batchId: 'note-batch-2',
    })
    for (const reader of [s.actors.owner, s.actors.editor, s.actors.editorLx]) {
      const { entries } = await listHistory(db, reader, { showId: s.show.id })
      expect(entries.map((e) => e.rowId)).not.toContain(note.id)
      const { groups } = await activityFeed(db, reader, { showId: s.show.id })
      expect(groups.find((g) => g.batchId === 'note-batch')).toBeUndefined()
      expect(groups.find((g) => g.batchId === 'note-batch-2')).toBeUndefined()
      // filtering by the viewer's personal layer, or by row, or by user, does not get round it
      for (const input of [
        { layer: `personal:${s.viewer.id}` },
        { rowId: note.id },
        { userId: s.viewer.id },
        { table: 'annotations' },
      ]) {
        expect((await listHistory(db, reader, { showId: s.show.id, ...input })).entries).toEqual([])
      }
      expect(
        (await activityFeed(db, reader, { showId: s.show.id, layer: `personal:${s.viewer.id}` }))
          .groups,
      ).toEqual([])
    }
    const mine = await listHistory(db, s.actors.viewer, { showId: s.show.id, rowId: note.id })
    expect(mine.entries).toHaveLength(2)
    const myFeed = await activityFeed(db, s.actors.viewer, { showId: s.show.id })
    expect(myFeed.groups.find((g) => g.batchId === 'note-batch')).toMatchObject({
      summary: 'added 1 annotation',
    })
    const myLayer = await listHistory(db, s.actors.viewer, {
      showId: s.show.id,
      layer: `personal:${s.viewer.id}`,
    })
    expect(myLayer.entries).toHaveLength(2)
  })

  test('a personal-to-department move hides the former personal layer id from everyone but its owner', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const note = await createAnnotation(db, s.actors.editor, personalNote(s, s.editor.id))
    await updateAnnotation(db, s.actors.editor, {
      annotationId: note.id,
      patch: { layerKind: 'department', layerId: s.depts.LX.id },
      batchId: 'publish-note',
    })
    const [raw] = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.rowId, note.id), eq(changeLog.op, 'update')))
    // the stored row is never rewritten; redaction happens on read
    expect(raw.layer).toBe(`department:${s.depts.LX.id}`)
    expect(raw.before).toEqual({ layerKind: 'personal', layerId: s.editor.id })

    const own = await listHistory(db, s.actors.editor, { showId: s.show.id, rowId: note.id })
    expect(own.entries).toHaveLength(2)
    expect(own.entries[0].before).toEqual({ layerKind: 'personal', layerId: s.editor.id })

    for (const reader of [s.actors.owner, s.actors.editorLx, s.actors.viewer]) {
      const { entries } = await listHistory(db, reader, { showId: s.show.id, rowId: note.id })
      // the personal insert is invisible; the move to the LX layer is visible with the id redacted
      expect(entries).toHaveLength(1)
      expect(entries[0].before).toEqual({ layerKind: 'personal', layerId: null })
      expect(entries[0].after).toMatchObject({ layerKind: 'department', layerId: s.depts.LX.id })
      expect(JSON.stringify(entries[0].before)).not.toContain(s.editor.id)
    }
  })
})

describe('activityFeed', () => {
  test('groups by batch and user: "moved 3 TM cues and relabelled 1"', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const made = []
    for (let i = 0; i < 4; i++) {
      made.push(
        await newCue(s, s.actors.owner, 'TM', {
          label: `tm${i}`,
          number: { major: 10 + i, minor: 0 },
          anchor: anchorAt(s.docId, s.versionId, 0, 100, 700 - i * 20),
        }),
      )
    }
    const batchId = 'move-batch'
    for (const cue of made.slice(0, 3)) {
      await updateCue(db, s.actors.owner, {
        cueId: cue.id,
        patch: { anchor: anchorAt(s.docId, s.versionId, 1, 100, 500) },
        batchId,
      })
    }
    await updateCue(db, s.actors.owner, { cueId: made[3].id, patch: { label: 'renamed' }, batchId })
    const { groups, nextBefore } = await activityFeed(db, s.actors.owner, { showId: s.show.id })
    expect(nextBefore).toBeNull()
    const group = groups[0]
    expect(group).toMatchObject({
      batchId,
      userId: s.owner.id,
      label: 'Olive',
      summary: 'moved 3 TM cues and relabelled 1',
      count: 4,
      via: 'web',
      agent: null,
    })
    expect(group.toSeq - group.fromSeq).toBe(3)
    const [newest] = await db.select().from(changeLog).where(eq(changeLog.seq, group.toSeq))
    expect(group.at).toBe(newest.serverTs.toISOString())
    // the four creates were one batch each (service calls make a batch per call): newest first
    expect(groups.slice(1, 5).map((g) => g.summary)).toEqual(Array(4).fill('placed 1 TM cue'))
  })

  test('an agent batch is labelled "<name> via <agent>" and the kind filter splits humans from agents', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const claude = asAgent(s.actors.owner, 'Claude Code/2.1.0')
    await newCue(s, s.actors.owner, 'LX', { batchId: 'human' })
    await newCue(s, claude, 'LX', { batchId: 'agent' })
    const all = await activityFeed(db, s.actors.owner, { showId: s.show.id })
    expect(all.groups.slice(0, 2).map((g) => [g.batchId, g.label, g.via, g.agent])).toEqual([
      ['agent', 'Olive via Claude Code', 'mcp', 'Claude Code/2.1.0'],
      ['human', 'Olive', 'web', null],
    ])
    const agents = await activityFeed(db, s.actors.owner, { showId: s.show.id, kind: 'agent' })
    expect(agents.groups.map((g) => g.batchId)).toEqual(['agent'])
    const humans = await activityFeed(db, s.actors.owner, { showId: s.show.id, kind: 'human' })
    expect(humans.groups.map((g) => g.batchId)).not.toContain('agent')
    expect(humans.groups.map((g) => g.batchId)).toContain('human')
  })

  test('two users reusing a batch id are two groups, a separated run is two groups, a null batch id stands alone', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    await newCue(s, s.actors.owner, 'LX', { batchId: 'same' })
    await newCue(s, s.actors.editor, 'LX', { batchId: 'same' })
    await newCue(s, s.actors.editor, 'LX', { batchId: 'same' }) // joins the editor's run
    await newCue(s, s.actors.owner, 'LX', { batchId: 'same' })
    await newCue(s, s.actors.owner, 'SND', { batchId: 'other' })
    await newCue(s, s.actors.owner, 'LX', { batchId: 'same' }) // not adjacent to the earlier owner run
    for (let i = 0; i < 2; i++) {
      await db.insert(changeLog).values({
        showId: s.show.id,
        userId: s.owner.id,
        via: 'web',
        batchId: null,
        tableName: 'shows',
        rowId: s.show.id,
        op: 'update',
        before: { title: 'a' },
        after: { title: 'b' },
        layer: null,
      })
    }
    const { groups } = await activityFeed(db, s.actors.owner, { showId: s.show.id })
    const shape = groups.slice(0, 7).map((g) => [g.batchId, g.userId, g.count])
    expect(shape).toEqual([
      [null, s.owner.id, 1],
      [null, s.owner.id, 1],
      ['same', s.owner.id, 1],
      ['other', s.owner.id, 1],
      ['same', s.owner.id, 1],
      ['same', s.editor.id, 2],
      ['same', s.owner.id, 1],
    ])
    expect(groups[0].summary).toBe('updated 1 show')
  })

  test("department codes in the sentence come from each row's layer", async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    await newCue(s, s.actors.owner, 'LX', { batchId: 'mixed' })
    await newCue(s, s.actors.owner, 'SND', { batchId: 'mixed' })
    await newCue(s, s.actors.owner, 'SND', { batchId: 'mixed' })
    await createAnnotation(db, s.actors.owner, {
      ...personalNote(s, s.owner.id),
      batchId: 'mixed',
    })
    const [g] = (await activityFeed(db, s.actors.owner, { showId: s.show.id })).groups
    expect(g.batchId).toBe('mixed')
    expect(g.summary).toBe('added 1 LX cue; added 2 SND cues; added 1 annotation')
  })

  test('layer, from and to narrow the feed; a later task can ask "what changed since this export"', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    await newCue(s, s.actors.owner, 'LX', { batchId: 'b1' })
    await newCue(s, s.actors.owner, 'SND', { batchId: 'b2' })
    await newCue(s, s.actors.owner, 'LX', { batchId: 'b3' })
    await stampTimeline(s)
    const batches = (r: Awaited<ReturnType<typeof activityFeed>>) => r.groups.map((g) => g.batchId)
    const lx = await activityFeed(db, s.actors.owner, {
      showId: s.show.id,
      layer: `department:${s.depts.LX.id}`,
    })
    // the seeding of the LX department itself is the oldest group on its layer
    expect(batches(lx).slice(0, 2)).toEqual(['b3', 'b1'])
    expect(lx.groups).toHaveLength(3)
    const rows = await db
      .select()
      .from(changeLog)
      .where(eq(changeLog.showId, s.show.id))
      .orderBy(changeLog.seq)
    const ts = (batch: string) => rows.find((r) => r.batchId === batch)?.serverTs as Date
    const since = await activityFeed(db, s.actors.owner, { showId: s.show.id, from: ts('b2') })
    expect(batches(since)).toEqual(['b3', 'b2'])
    const upTo = await activityFeed(db, s.actors.owner, { showId: s.show.id, to: ts('b2') })
    expect(batches(upTo).slice(0, 2)).toEqual(['b2', 'b1'])
    const only = await activityFeed(db, s.actors.owner, {
      showId: s.show.id,
      from: ts('b2'),
      to: ts('b2'),
    })
    expect(batches(only)).toEqual(['b2'])
  })

  test('pages by group: limit and before never split a batch', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    for (const [batch, n] of [
      ['p1', 3],
      ['p2', 1],
      ['p3', 2],
    ] as const) {
      for (let i = 0; i < n; i++) await newCue(s, s.actors.owner, 'LX', { batchId: batch })
    }
    const page1 = await activityFeed(db, s.actors.owner, {
      showId: s.show.id,
      layer: `department:${s.depts.LX.id}`,
      limit: 2,
    })
    expect(page1.groups.map((g) => [g.batchId, g.count])).toEqual([
      ['p3', 2],
      ['p2', 1],
    ])
    expect(page1.nextBefore).toBe(page1.groups[1].fromSeq)
    const page2 = await activityFeed(db, s.actors.owner, {
      showId: s.show.id,
      layer: `department:${s.depts.LX.id}`,
      limit: 2,
      before: page1.nextBefore ?? undefined,
    })
    // then the LX department's own seeding insert, the last group on the layer
    expect(page2.groups.map((g) => [g.batchId, g.count]).slice(0, 1)).toEqual([['p1', 3]])
    expect(page2.groups).toHaveLength(2)
    expect(page2.nextBefore).toBeNull()
  })
})

describe('completeness', () => {
  test('every accepted sync change produced exactly one change log row with the touched columns', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const cueId = newId()
    const annId = newId()
    const cueRow = {
      show_id: s.show.id,
      department_id: s.depts.LX.id,
      major: 5,
      minor: 0,
      label: 'Start',
      anchor: null,
      type: 'go',
      notes: '',
      colour: null,
    }
    const annRow = {
      show_id: s.show.id,
      layer_kind: 'department',
      layer_id: s.depts.LX.id,
      anchor: JSON.stringify(anchorAt(s.docId, s.versionId, 1)),
      type: 'note',
      geometry: '{}',
      text: 'hi',
      style: '{}',
    }
    const entries: SyncCrudEntry[] = [
      { table: 'cues', id: cueId, op: 'PUT', data: cueRow },
      { table: 'cues', id: cueId, op: 'PATCH', data: { label: 'Start!' } },
      { table: 'cues', id: cueId, op: 'PATCH', data: { label: 'Start!' } }, // a no-op writes none
      { table: 'annotations', id: annId, op: 'PUT', data: annRow },
      { table: 'annotations', id: annId, op: 'PATCH', data: { text: 'hello' } },
      { table: 'annotations', id: annId, op: 'DELETE' },
      { table: 'cues', id: cueId, op: 'PATCH', data: { major: 6, minor: 50 } },
      { table: 'cues', id: cueId, op: 'DELETE' },
    ]
    const res = await s.app.request('/api/sync/upload', {
      method: 'POST',
      headers: { cookie: s.owner.cookie, origin: APP_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ batchId: 'dev-1', entries }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { applied: number; rejected: unknown[] }
    expect(body.rejected).toEqual([])
    expect(body.applied).toBe(entries.length)

    const logs = await db
      .select()
      .from(changeLog)
      .where(eq(changeLog.batchId, `${s.owner.id}:dev-1`))
      .orderBy(changeLog.seq)
    // seven writes changed something; the repeated label patch was a no-op
    expect(
      logs.map((l) => [l.tableName, l.op, Object.keys(l.after ?? l.before ?? {}).sort()]),
    ).toEqual([
      [
        'cues',
        'insert',
        ['anchor', 'colour', 'departmentId', 'label', 'major', 'minor', 'notes', 'type'],
      ],
      ['cues', 'update', ['label']],
      [
        'annotations',
        'insert',
        ['anchor', 'geometry', 'layerId', 'layerKind', 'style', 'text', 'type'],
      ],
      ['annotations', 'update', ['text']],
      [
        'annotations',
        'delete',
        ['anchor', 'geometry', 'layerId', 'layerKind', 'style', 'text', 'type'],
      ],
      ['cues', 'update', ['major', 'minor']],
      [
        'cues',
        'delete',
        ['anchor', 'colour', 'departmentId', 'label', 'major', 'minor', 'notes', 'type'],
      ],
    ])
    expect(logs.every((l) => l.via === 'sync' && l.userId === s.owner.id)).toBe(true)
    expect(logs[1]).toMatchObject({ before: { label: 'Start' }, after: { label: 'Start!' } })
    expect(logs[5]).toMatchObject({
      before: { major: 5, minor: 0 },
      after: { major: 6, minor: 50 },
    })

    // and the feed folds the whole upload into one sentence
    const [group] = (await activityFeed(db, s.actors.owner, { showId: s.show.id })).groups
    expect(group).toMatchObject({ batchId: `${s.owner.id}:dev-1`, count: 7 })
    expect(group.summary).toBe(
      'added 1 LX cue, renumbered 1, relabelled 1 and deleted 1; added 1 LX annotation, edited 1 and deleted 1',
    )
  })
})

describe('HTTP', () => {
  test('GET history and activity honour filters and the session; a non-member gets 404', async () => {
    const s = await setupMarkupShow()
    const cue = await newCue(s, s.actors.owner, 'LX', { batchId: 'h1' })
    await updateShow(s.deps.db, s.actors.owner, { showId: s.show.id, patch: { title: 'Renamed' } })
    const get = (path: string, cookie = s.owner.cookie) =>
      s.app.request(path, { headers: { cookie } })

    const history = await get(`/api/shows/${s.show.id}/history?rowId=${cue.id}&limit=5`)
    expect(history.status).toBe(200)
    const body = (await history.json()) as {
      entries: { rowId: string; op: string }[]
      nextBefore: null
    }
    expect(body.entries.map((e) => [e.rowId, e.op])).toEqual([[cue.id, 'insert']])
    expect(body.nextBefore).toBeNull()

    const feed = await get(`/api/shows/${s.show.id}/activity?kind=human&limit=1`)
    expect(feed.status).toBe(200)
    const groups = ((await feed.json()) as { groups: { summary: string }[]; nextBefore: number })
      .groups
    expect(groups[0].summary).toBe('updated 1 show')

    const since = await get(
      `/api/shows/${s.show.id}/history?table=shows&from=${encodeURIComponent('2000-01-01T00:00:00Z')}&to=${encodeURIComponent('2100-01-01T00:00:00Z')}`,
    )
    // the show's creation and the rename
    expect(
      ((await since.json()) as { entries: { op: string }[] }).entries.map((e) => e.op),
    ).toEqual(['update', 'insert'])

    expect((await get(`/api/shows/${s.show.id}/history?limit=0`)).status).toBe(400)
    expect((await get(`/api/shows/${s.show.id}/history?from=yesterday`)).status).toBe(400)
    expect((await get(`/api/shows/${s.show.id}/history?kind=robots`)).status).toBe(400)
    expect((await get(`/api/shows/${s.show.id}/history`, s.outsider.cookie)).status).toBe(404)
    expect((await s.app.request(`/api/shows/${s.show.id}/activity`)).status).toBe(401)
  })
})
