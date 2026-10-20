import { caretX } from '@binder/core'
import { changeLog } from '@binder/db'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createCue, createToken, listCues } from '../src/services'
import { lineLayer, putWordLayer, setupMarkupShow } from './markupHelpers'
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

const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'

beforeAll(async () => {
  s = await setupMarkupShow()
  await putWordLayer(s.deps.db, s.deps.blobs, s.versionId, 0, lineLayer(WORDS))
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

  describe('marks', () => {
    const place = (args: Record<string, unknown>) =>
      callTool(owner, 'place_cue_at_text', {
        showId: s.show.id,
        department: 'LX',
        documentId: s.docId,
        quote: WORDS,
        ...args,
      })

    test('place_cue_at_text with mark highlight anchors the whole matched quote, not eight words', async () => {
      const plain = await place({})
      expect(plain.structuredContent?.cue.anchor.text.quote).toBe(
        WORDS.split(' ').slice(0, 8).join(' '),
      )
      expect(plain.structuredContent?.cue.anchor.mark).toBeUndefined()

      const res = await place({ mark: 'highlight' })
      expect(res.isError).toBeFalsy()
      expect(res.structuredContent?.status).toBe('placed')
      expect(res.structuredContent?.cue.anchor).toMatchObject({
        mark: 'highlight',
        pageIndex: 0,
        text: { quote: WORDS, wordStart: 0, wordEnd: 9 },
      })
    })

    test('place_cue_at_text with mark line and charOffset 3 stores text.offset 3 and x at the caret', async () => {
      const res = await place({ quote: 'bravo charlie', mark: 'line', charOffset: 3 })
      expect(res.isError).toBeFalsy()
      const anchor = res.structuredContent?.cue.anchor
      expect(anchor).toMatchObject({
        mark: 'line',
        text: { quote: 'bravo charlie', wordStart: 1, wordEnd: 2, offset: 3 },
      })
      expect(anchor.x).toBeCloseTo(caretX({ t: 'bravo', x: 150, w: 45 }, 3), 6)
      expect(anchor.x).toBeGreaterThan(150)
      expect(anchor.x).toBeLessThan(195)

      const pointer = await place({ quote: 'bravo charlie', mark: 'pointer' })
      expect(pointer.structuredContent?.cue.anchor).toMatchObject({
        mark: 'pointer',
        x: 150,
        text: { offset: 0 },
      })
    })

    test('charOffset with underline is an error', async () => {
      for (const args of [
        { charOffset: 2 },
        { mark: 'underline', charOffset: 2 },
        { mark: 'highlight', charOffset: 1 },
      ]) {
        const res = await place(args)
        expect(res.isError).toBe(true)
        expect(resultText(res)).toMatch(/^invalid:/)
      }
      // past the end of the first word ("alpha" has five characters)
      const past = await place({ mark: 'line', charOffset: 6 })
      expect(resultText(past)).toMatch(/^invalid: .*past the end/)
      const end = await place({ mark: 'line', charOffset: 5 })
      expect(end.structuredContent?.cue.anchor.text.offset).toBe(5)
    })

    test('update_cue mark highlight changes only the mark', async () => {
      const made = await place({ quote: 'bravo charlie delta' })
      const before = made.structuredContent?.cue
      const upd = await callTool(owner, 'update_cue', { cueId: before.id, mark: 'highlight' })
      expect(upd.isError).toBeFalsy()
      expect(upd.structuredContent?.anchor).toEqual({ ...before.anchor, mark: 'highlight' })

      const back = await callTool(owner, 'update_cue', { cueId: before.id, mark: 'underline' })
      expect(back.structuredContent?.anchor).toEqual(before.anchor)

      const line = await callTool(owner, 'update_cue', {
        cueId: before.id,
        mark: 'line',
        charOffset: 2,
      })
      expect(line.structuredContent?.anchor).toMatchObject({
        mark: 'line',
        text: { quote: 'bravo charlie delta', offset: 2 },
      })
      expect(line.structuredContent?.anchor.x).toBeCloseTo(
        caretX({ t: 'bravo', x: 150, w: 45 }, 2),
        6,
      )
      // a later charOffset alone moves the bar, and switching away drops the offset
      const moved = await callTool(owner, 'update_cue', { cueId: before.id, charOffset: 4 })
      expect(moved.structuredContent?.anchor.text.offset).toBe(4)
      const clamped = await callTool(owner, 'update_cue', { cueId: before.id, charOffset: 99 })
      expect(clamped.structuredContent?.anchor.text.offset).toBe(5)
      const off = await callTool(owner, 'update_cue', { cueId: before.id, mark: 'highlight' })
      expect(off.structuredContent?.anchor.text.offset).toBeUndefined()
    })

    test('update_cue with an anchor and a mark applies the anchor first, then the mark', async () => {
      const made = await place({ quote: 'bravo charlie' })
      const upd = await callTool(owner, 'update_cue', {
        cueId: made.structuredContent?.cue.id,
        anchor: { documentId: s.docId, pageIndex: 3, x: 40, y: 50 },
        mark: 'pointer',
      })
      expect(upd.structuredContent?.anchor).toMatchObject({
        pageIndex: 3,
        x: 40,
        y: 50,
        mark: 'pointer',
      })
      expect(upd.structuredContent?.anchor.text).toBeUndefined()
    })

    test('update_cue charOffset on an unbound cue is an error', async () => {
      const made = await callTool(owner, 'create_cue', {
        showId: s.show.id,
        department: 'LX',
        anchor: { documentId: s.docId, pageIndex: 1, x: 100, y: 200 },
      })
      const id = made.structuredContent?.id
      const res = await callTool(owner, 'update_cue', { cueId: id, mark: 'line', charOffset: 1 })
      expect(resultText(res)).toMatch(/^invalid:/)
      // a mark alone is fine: a free bar
      const free = await callTool(owner, 'update_cue', { cueId: id, mark: 'line' })
      expect(free.structuredContent?.anchor).toMatchObject({ mark: 'line', x: 100, y: 200 })

      // charOffset on a bound cue whose mark is not a line or pointer
      const bound = await place({ quote: 'echo foxtrot' })
      const bad = await callTool(owner, 'update_cue', {
        cueId: bound.structuredContent?.cue.id,
        charOffset: 1,
      })
      expect(resultText(bad)).toMatch(/^invalid:/)

      // an unplaced cue cannot be restyled
      const unplaced = await callTool(owner, 'create_cue', { showId: s.show.id, department: 'LX' })
      const none = await callTool(owner, 'update_cue', {
        cueId: unplaced.structuredContent?.id,
        mark: 'highlight',
      })
      expect(resultText(none)).toMatch(/^invalid: .*unplaced/)
    })

    test('update_cue with anchor null and a mark says the call both unplaces and restyles', async () => {
      const made = await place({ quote: 'bravo charlie' })
      const id = made.structuredContent?.cue.id
      for (const extra of [{ mark: 'highlight' }, { charOffset: 1 }]) {
        const res = await callTool(owner, 'update_cue', { cueId: id, anchor: null, ...extra })
        expect(resultText(res)).toMatch(/^invalid: .*unplaces.*restyles/)
        expect(resultText(res)).not.toMatch(/place it before/)
      }
      // nothing was applied: the cue is still placed
      const still = await callTool(owner, 'get_cue', { cueId: id })
      expect(still.structuredContent?.anchor).toBeTruthy()
    })

    test('create_cue with a coordinates anchor and mark line makes a free bar (no text, no offset)', async () => {
      const made = await callTool(owner, 'create_cue', {
        showId: s.show.id,
        department: 'LX',
        anchor: { documentId: s.docId, pageIndex: 0, x: 222, y: 333, mark: 'line' },
      })
      expect(made.isError).toBeFalsy()
      expect(made.structuredContent?.anchor).toMatchObject({ mark: 'line', x: 222, y: 333 })
      expect(made.structuredContent?.anchor.text).toBeUndefined()

      const under = await callTool(owner, 'create_cue', {
        showId: s.show.id,
        department: 'LX',
        anchor: { documentId: s.docId, pageIndex: 0, x: 1, y: 2, mark: 'underline' },
      })
      expect(under.structuredContent?.anchor.mark).toBeUndefined()
    })
  })
})
