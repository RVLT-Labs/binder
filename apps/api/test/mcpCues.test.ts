import { changeLog } from '@binder/db'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createCue, createToken, listCues } from '../src/services'
import { setupMarkupShow } from './markupHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>
let s: Setup
let owner: Client
let lx: Client
const clients: Client[] = []

async function connect(userId: string, name = 'test-client') {
  const actor = { userId, via: 'web' as const, agent: null }
  const { token } = await createToken(s.deps.db, actor, { name: 't', showScope: '*' })
  const c = await connectMcp(s.app, token, { name, version: '1.0.0' })
  clients.push(c)
  return c
}

beforeAll(async () => {
  s = await setupMarkupShow()
  owner = await connect(s.owner.id, 'claude-desktop')
  lx = await connect(s.editorLx.id)
})
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

describe('cue tools', () => {
  test('create_cue by department code and number "14.5" returns display and id; list_cues paginates', async () => {
    const made = await callTool(owner, 'create_cue', {
      showId: s.show.id,
      department: 'tm',
      number: '14.5',
      label: 'Preset',
      anchor: { documentId: s.docId, pageIndex: 2, x: 120, y: 500 },
    })
    expect(made.isError).toBeFalsy()
    expect(made.structuredContent).toMatchObject({
      display: '14.50',
      departmentCode: 'TM',
      major: 14,
      minor: 50,
      label: 'Preset',
      anchor: { documentVersionId: s.versionId, pageIndex: 2, status: 'ok' },
    })
    expect(typeof made.structuredContent?.id).toBe('string')

    // a department id works too; an unknown department or a bad number is invalid
    const byId = await callTool(owner, 'create_cue', {
      showId: s.show.id,
      department: s.depts.LX.id,
      number: '1',
    })
    expect(byId.structuredContent).toMatchObject({ departmentCode: 'LX', display: '1' })
    expect(
      resultText(await callTool(owner, 'create_cue', { showId: s.show.id, department: 'ZZZ' })),
    ).toMatch(/^invalid:/)
    expect(
      resultText(
        await callTool(owner, 'create_cue', {
          showId: s.show.id,
          department: 'LX',
          number: '14.123',
        }),
      ),
    ).toMatch(/^invalid:/)

    for (const n of [2, 3, 4]) {
      await callTool(owner, 'create_cue', {
        showId: s.show.id,
        department: 'LX',
        number: String(n),
      })
    }
    const page1 = await callTool(owner, 'list_cues', {
      showId: s.show.id,
      department: 'LX',
      limit: 2,
    })
    expect(page1.structuredContent?.items.map((c: { display: string }) => c.display)).toEqual([
      '1',
      '2',
    ])
    expect(page1.structuredContent?.nextCursor).toBe('2')
    const page2 = await callTool(owner, 'list_cues', {
      showId: s.show.id,
      department: 'LX',
      limit: 2,
      cursor: page1.structuredContent?.nextCursor,
    })
    expect(page2.structuredContent?.items.map((c: { display: string }) => c.display)).toEqual([
      '3',
      '4',
    ])
    expect(page2.structuredContent?.nextCursor).toBeUndefined()
    const placed = await callTool(owner, 'list_cues', { showId: s.show.id, placed: true })
    expect(placed.structuredContent?.items).toHaveLength(1)
  })

  test('get_cue, update_cue and permissions', async () => {
    const made = await callTool(lx, 'create_cue', {
      showId: s.show.id,
      department: 'LX',
      number: '30',
      label: 'a',
    })
    const id = made.structuredContent?.id
    const got = await callTool(lx, 'get_cue', { cueId: id })
    expect(got.structuredContent).toMatchObject({ id, display: '30', departmentCode: 'LX' })

    const upd = await callTool(lx, 'update_cue', {
      cueId: id,
      number: '30.5',
      label: 'b',
      colour: '#ABCDEF',
    })
    expect(upd.structuredContent).toMatchObject({ display: '30.5', label: 'b', colour: '#ABCDEF' })
    const moved = await callTool(lx, 'update_cue', { cueId: id, department: 'SND' })
    expect(resultText(moved)).toMatch(/^forbidden:/)
    const bad = await callTool(lx, 'update_cue', { cueId: id, number: 'x' })
    expect(resultText(bad)).toMatch(/^invalid:/)
    const denied = await callTool(lx, 'create_cue', { showId: s.show.id, department: 'SND' })
    expect(resultText(denied)).toMatch(/^forbidden:/)
    const unplaced = await callTool(owner, 'update_cue', {
      cueId: id,
      anchor: { documentId: s.docId, pageIndex: 1, x: 1, y: 2 },
    })
    expect(unplaced.structuredContent?.anchor).toMatchObject({ pageIndex: 1 })
    const cleared = await callTool(owner, 'update_cue', { cueId: id, anchor: null })
    expect(cleared.structuredContent?.anchor).toBeNull()
  })

  test('delete_cues with eleven ids returns CONFIRMATION_REQUIRED and deletes nothing; with confirm it deletes all', async () => {
    const ids: string[] = []
    for (let i = 0; i < 11; i++) {
      const c = await createCue(s.deps.db, s.actors.owner, {
        showId: s.show.id,
        departmentId: i % 2 ? s.depts.VID.id : s.depts.SM.id,
        number: { major: 100 + i, minor: 0 },
      })
      ids.push(c.id)
    }
    const before = (await listCues(s.deps.db, s.actors.owner, { showId: s.show.id })).length
    const asked = await callTool(owner, 'delete_cues', { cueIds: ids })
    expect(asked.isError).toBe(true)
    expect(asked.structuredContent).toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(resultText(asked)).toMatch(
      /^CONFIRMATION_REQUIRED: .*11 cues.*SM.*VID.* Call again with confirm: true to proceed\.$/,
    )
    expect(await listCues(s.deps.db, s.actors.owner, { showId: s.show.id })).toHaveLength(before)

    const done = await callTool(owner, 'delete_cues', { cueIds: ids, confirm: true })
    expect(done.isError).toBeFalsy()
    expect(done.structuredContent?.deleted).toHaveLength(11)
    expect(await listCues(s.deps.db, s.actors.owner, { showId: s.show.id })).toHaveLength(
      before - 11,
    )

    // ten or fewer need no confirmation
    const one = await createCue(s.deps.db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.SM.id,
    })
    const quick = await callTool(owner, 'delete_cues', { cueIds: [one.id] })
    expect(quick.structuredContent?.deleted).toEqual([one.id])
  })

  test('cue writes through MCP log via mcp with the client name as agent', async () => {
    const made = await callTool(owner, 'create_cue', {
      showId: s.show.id,
      department: 'LX',
      label: 'logged',
    })
    const rows = await s.deps.db
      .select()
      .from(changeLog)
      .where(eq(changeLog.rowId, made.structuredContent?.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ via: 'mcp', tableName: 'cues', op: 'insert' })
    expect(rows[0].agent).toMatch(/claude-desktop/)
    expect(rows[0].layer).toBe(`department:${s.depts.LX.id}`)
  })
})
