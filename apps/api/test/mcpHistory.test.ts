import { changeLog, cues } from '@binder/db'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  createAnnotation,
  createCue,
  createShow,
  createToken,
  getCue,
  listCues,
  listOrganisations,
  updateCue,
} from '../src/services'
import { anchorAt, setupMarkupShow } from './markupHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>
let s: Setup
let owner: Client
let lx: Client
let viewer: Client
let scoped: Client
const clients: Client[] = []

async function connect(userId: string, showScope: '*' | string[] = '*') {
  const actor = { userId, via: 'web' as const, agent: null }
  const { token } = await createToken(s.deps.db, actor, { name: 't', showScope })
  const c = await connectMcp(s.app, token)
  clients.push(c)
  return c
}

beforeAll(async () => {
  s = await setupMarkupShow()
  owner = await connect(s.owner.id)
  lx = await connect(s.editorLx.id)
  viewer = await connect(s.viewer.id)
  const [org] = await listOrganisations(s.deps.db, s.actors.owner)
  const elsewhere = await createShow(s.deps.db, s.actors.owner, {
    organisationId: org.id,
    title: 'Elsewhere',
  })
  scoped = await connect(s.owner.id, [elsewhere.id])
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

const rowCount = async (table: typeof cues, showId: string) =>
  (await s.deps.db.select({ id: table.id }).from(table).where(eq(table.showId, showId))).length

/** A batch of `n` placed cues in LX written by the owner. */
async function placeBatch(batchId: string, n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const cue = await createCue(s.deps.db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      label: `placed ${i}`,
      anchor: anchorAt(s.docId, s.versionId, 0, 100, 700 - i * 10),
      batchId,
    })
    ids.push(cue.id)
  }
  return ids
}

describe('get_history and get_activity', () => {
  test('get_activity labels MCP batches "<name> via test-client"; revert_change works through MCP', async () => {
    const made = await callTool(lx, 'create_cue', {
      showId: s.show.id,
      department: 'LX',
      label: 'via agent',
    })
    const cueId = made.structuredContent?.id
    await callTool(lx, 'update_cue', { cueId, label: 'via agent, renamed' })

    const feed = await callTool(owner, 'get_activity', { showId: s.show.id, limit: 2 })
    expect(feed.isError).toBeFalsy()
    const groups = feed.structuredContent?.groups
    expect(groups[0]).toMatchObject({
      label: 'Lex via test-client',
      summary: 'relabelled 1 LX cue',
      userId: s.editorLx.id,
      via: 'mcp',
      count: 1,
    })
    expect(groups[1]).toMatchObject({ label: 'Lex via test-client', summary: 'added 1 LX cue' })
    expect(typeof feed.structuredContent?.nextBefore).toBe('number')

    const history = await callTool(owner, 'get_history', {
      showId: s.show.id,
      rowId: cueId,
    })
    const entries = (history.structuredContent?.entries ?? []) as Array<Record<string, unknown>>
    const [update, insert] = entries
    expect(update).toMatchObject({
      op: 'update',
      userName: 'Lex',
      via: 'mcp',
      before: { label: 'via agent' },
      after: { label: 'via agent, renamed' },
    })
    expect(insert.agent).toMatch(/^test-client/)

    const reverted = await callTool(owner, 'revert_change', { seq: update.seq })
    expect(reverted.isError).toBeFalsy()
    expect(reverted.structuredContent).toMatchObject({ reverted: 1, skipped: [] })
    expect(typeof reverted.structuredContent?.batchId).toBe('string')
    expect((await getCue(s.deps.db, s.actors.owner, { cueId })).label).toBe('via agent')

    const again = await callTool(owner, 'revert_change', { seq: update.seq })
    expect(again.isError).toBe(true)
    expect(resultText(again)).toMatch(/^conflict:/)
    // forced, but the old values are already back: nothing to write, reported as skipped
    const forced = await callTool(owner, 'revert_change', { seq: update.seq, force: true })
    expect(forced.structuredContent).toMatchObject({
      reverted: 0,
      skipped: [{ seq: update.seq, reason: 'already-reverted' }],
    })
  })

  test('both read tools page by before and filter by kind, layer, user, and time', async () => {
    const solo = await setupMarkupShow()
    const soloOwner = await connectMcp(
      solo.app,
      (await createToken(solo.deps.db, solo.actors.owner, { name: 'solo', showScope: '*' })).token,
      { name: 'Claude Code', version: '2.1.0' },
    )
    clients.push(soloOwner)
    for (let i = 0; i < 3; i++) {
      await createCue(solo.deps.db, solo.actors.owner, {
        showId: solo.show.id,
        departmentId: solo.depts.SND.id,
        batchId: `human-${i}`,
      })
    }
    await callTool(soloOwner, 'create_cue', { showId: solo.show.id, department: 'LX' })

    const agent = await callTool(soloOwner, 'get_history', { showId: solo.show.id, kind: 'agent' })
    expect(agent.structuredContent?.entries).toHaveLength(1)
    expect(agent.structuredContent?.entries[0].agent).toMatch(/^Claude Code\/2\.1/)
    const feedAgent = await callTool(soloOwner, 'get_activity', {
      showId: solo.show.id,
      kind: 'agent',
    })
    expect(feedAgent.structuredContent?.groups.map((g: { label: string }) => g.label)).toEqual([
      'Olive via Claude Code',
    ])

    const sndLayer = `department:${solo.depts.SND.id}`
    const snd = await callTool(soloOwner, 'get_history', {
      showId: solo.show.id,
      layer: sndLayer,
      table: 'cues',
      limit: 2,
    })
    expect(snd.structuredContent?.entries).toHaveLength(2)
    const next = await callTool(soloOwner, 'get_history', {
      showId: solo.show.id,
      layer: sndLayer,
      table: 'cues',
      limit: 2,
      before: snd.structuredContent?.nextBefore,
    })
    expect(next.structuredContent?.entries).toHaveLength(1)
    expect(next.structuredContent?.nextBefore).toBeNull()

    // a department code or id works for layer, and "personal" means the caller's own
    const byCode = await callTool(soloOwner, 'get_history', {
      showId: solo.show.id,
      layer: 'SND',
      table: 'cues',
    })
    expect(byCode.structuredContent?.entries).toHaveLength(3)
    const byId = await callTool(soloOwner, 'get_activity', {
      showId: solo.show.id,
      layer: solo.depts.SND.id,
    })
    expect(
      byId.structuredContent?.groups.slice(0, 3).map((g: { summary: string }) => g.summary),
    ).toEqual(['added 1 SND cue', 'added 1 SND cue', 'added 1 SND cue'])
    await createAnnotation(solo.deps.db, solo.actors.owner, {
      showId: solo.show.id,
      layerKind: 'personal',
      layerId: solo.owner.id,
      anchor: anchorAt(solo.docId, solo.versionId, 0),
      type: 'note',
      geometry: {},
      text: 'mine',
      style: {},
    })
    const personal = await callTool(soloOwner, 'get_history', {
      showId: solo.show.id,
      layer: 'personal',
    })
    expect(personal.structuredContent?.entries).toHaveLength(1)
    expect(
      resultText(await callTool(soloOwner, 'get_history', { showId: solo.show.id, layer: 'ZZZ' })),
    ).toMatch(/^invalid:/)

    const byUser = await callTool(soloOwner, 'get_history', {
      showId: solo.show.id,
      userId: solo.viewer.id,
    })
    expect(byUser.structuredContent?.entries).toEqual([])

    const future = await callTool(soloOwner, 'get_activity', {
      showId: solo.show.id,
      from: '2099-01-01T00:00:00Z',
    })
    expect(future.structuredContent?.groups).toEqual([])
    const sinceEpoch = await callTool(soloOwner, 'get_activity', {
      showId: solo.show.id,
      from: '2000-01-01T00:00:00Z',
      to: '2099-01-01T00:00:00Z',
      limit: 200,
    })
    expect(sinceEpoch.structuredContent?.groups.length).toBeGreaterThan(3)
    const badDate = await callTool(soloOwner, 'get_history', {
      showId: solo.show.id,
      from: 'yesterday',
    })
    expect(badDate.isError).toBe(true)
  })

  test('personal layers stay private through MCP, and a scoped token or non-member is refused', async () => {
    const note = await createAnnotation(s.deps.db, s.actors.viewer, {
      showId: s.show.id,
      layerKind: 'personal',
      layerId: s.viewer.id,
      anchor: anchorAt(s.docId, s.versionId, 0),
      type: 'note',
      geometry: {},
      text: 'private to the viewer',
      style: {},
    })
    const seenByOwner = await callTool(owner, 'get_history', { showId: s.show.id, rowId: note.id })
    expect(seenByOwner.structuredContent?.entries).toEqual([])
    const seenByViewer = await callTool(viewer, 'get_history', {
      showId: s.show.id,
      rowId: note.id,
    })
    expect(seenByViewer.structuredContent?.entries).toHaveLength(1)
    const feed = await callTool(owner, 'get_activity', { showId: s.show.id, limit: 200 })
    expect(JSON.stringify(feed.structuredContent)).not.toContain('private to the viewer')
    expect(feed.structuredContent?.groups.some((g: { toSeq: number }) => g.toSeq > 0)).toBe(true)

    for (const [tool, args] of [
      ['get_history', {}],
      ['get_activity', {}],
      ['revert_change', { seq: 1 }],
      ['revert_batch', { batchId: 'b', userId: s.owner.id }],
    ] as const) {
      const denied = await callTool(scoped, tool, { showId: s.show.id, ...args })
      expect(resultText(denied), tool).toMatch(/^forbidden:/)
    }
    // revert_change has no showId: a seq in a show the token cannot see answers like a missing one
    const [row] = await s.deps.db.select().from(changeLog).where(eq(changeLog.rowId, note.id))
    expect(resultText(await callTool(scoped, 'revert_change', { seq: row.seq }))).toMatch(
      /^forbidden:/,
    )
    expect(resultText(await callTool(owner, 'revert_change', { seq: row.seq }))).toMatch(
      /^not_found:/,
    )
  })
})

describe('revert_batch', () => {
  test('revert_batch over ten rows returns CONFIRMATION_REQUIRED and writes nothing; with confirm it reverts', async () => {
    const batchId = 'placed-eleven'
    await placeBatch(batchId, 11)
    const before = await rowCount(cues, s.show.id)
    const logsBefore = (
      await s.deps.db
        .select({ seq: changeLog.seq })
        .from(changeLog)
        .where(eq(changeLog.showId, s.show.id))
    ).length

    const r = await callTool(owner, 'revert_batch', {
      showId: s.show.id,
      batchId,
      userId: s.owner.id,
    })
    expect(r.isError).toBe(true)
    expect(r.structuredContent?.code).toBe('CONFIRMATION_REQUIRED')
    expect(resultText(r)).toMatch(
      /^CONFIRMATION_REQUIRED: Reverting this batch changes 11 rows and deletes 11\. Call again with confirm: true to proceed\.$/,
    )
    expect(await rowCount(cues, s.show.id)).toBe(before)
    expect(
      (
        await s.deps.db
          .select({ seq: changeLog.seq })
          .from(changeLog)
          .where(eq(changeLog.showId, s.show.id))
      ).length,
    ).toBe(logsBefore)

    const done = await callTool(owner, 'revert_batch', {
      showId: s.show.id,
      batchId,
      userId: s.owner.id,
      confirm: true,
    })
    expect(done.isError).toBeFalsy()
    expect(done.structuredContent).toMatchObject({ reverted: 11, skipped: [] })
    expect(await rowCount(cues, s.show.id)).toBe(before - 11)
  })

  test('ten rows need no confirmation, and eleven changed rows (no deletes) still need it', async () => {
    const ten = 'placed-ten'
    await placeBatch(ten, 10)
    const quick = await callTool(owner, 'revert_batch', {
      showId: s.show.id,
      batchId: ten,
      userId: s.owner.id,
    })
    expect(quick.isError).toBeFalsy()
    expect(quick.structuredContent).toMatchObject({ reverted: 10 })

    const ids = await placeBatch('base-eleven', 11)
    for (const id of ids) {
      await updateCue(s.deps.db, s.actors.owner, {
        cueId: id,
        patch: { label: 'renamed' },
        batchId: 'rename-eleven',
      })
    }
    const asked = await callTool(owner, 'revert_batch', {
      showId: s.show.id,
      batchId: 'rename-eleven',
      userId: s.owner.id,
    })
    expect(asked.structuredContent?.code).toBe('CONFIRMATION_REQUIRED')
    expect(resultText(asked)).toContain('changes 11 rows and deletes 0')
    const labels = (await listCues(s.deps.db, s.actors.owner, { showId: s.show.id }))
      .filter((c) => ids.includes(c.id))
      .map((c) => c.label)
    expect(new Set(labels)).toEqual(new Set(['renamed']))
    const done = await callTool(owner, 'revert_batch', {
      showId: s.show.id,
      batchId: 'rename-eleven',
      userId: s.owner.id,
      confirm: true,
    })
    expect(done.structuredContent).toMatchObject({ reverted: 11 })
  })

  test('errors surface as tool errors: another user, no rights, conflict; and the gate does not hide them', async () => {
    const [cueId] = await placeBatch('guarded', 1)
    await updateCue(s.deps.db, s.actors.owner, {
      cueId,
      patch: { label: 'changed' },
      batchId: 'guarded-2',
    })
    const wrongUser = await callTool(owner, 'revert_batch', {
      showId: s.show.id,
      batchId: 'guarded-2',
      userId: s.editorLx.id,
    })
    expect(resultText(wrongUser)).toMatch(/^not_found:/)
    const noRights = await callTool(viewer, 'revert_batch', {
      showId: s.show.id,
      batchId: 'guarded-2',
      userId: s.owner.id,
    })
    expect(resultText(noRights)).toMatch(/^forbidden:/)
    await updateCue(s.deps.db, s.actors.editorLx, { cueId, patch: { label: 'drifted' } })
    const drifted = await callTool(owner, 'revert_batch', {
      showId: s.show.id,
      batchId: 'guarded-2',
      userId: s.owner.id,
    })
    expect(resultText(drifted)).toMatch(/^conflict:.*label/)
    const forced = await callTool(owner, 'revert_batch', {
      showId: s.show.id,
      batchId: 'guarded-2',
      userId: s.owner.id,
      force: true,
    })
    expect(forced.structuredContent).toMatchObject({ reverted: 1 })
    expect((await getCue(s.deps.db, s.actors.owner, { cueId })).label).toBe('placed 0')
  })

  test('the tools are listed with read and write hints', async () => {
    const { tools } = await owner.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    for (const name of ['get_history', 'get_activity']) {
      expect(byName[name]?.annotations?.readOnlyHint, name).toBe(true)
    }
    for (const name of ['revert_change', 'revert_batch']) {
      expect(byName[name]?.annotations?.readOnlyHint, name).toBe(false)
    }
  })
})
