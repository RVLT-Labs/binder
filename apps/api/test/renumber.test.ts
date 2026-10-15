import { changeLog, documents, documentVersions } from '@binder/db'
import { newId } from '@binder/shared'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { AppError } from '../src/errors'
import { createCue, createToken, getCue, listCues, updateShow } from '../src/services'
import { renumberCues } from '../src/services/renumber'
import { addReadyDocument, anchorAt, setupMarkupShow } from './markupHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof AppError ? e.code : 'other'),
  )

const clients: Client[] = []
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

/** LX cues scrambled across pages: page 1 y700 -> 'c', page 0 y700 -> 'a', page 0 y300 -> 'b'. */
async function scrambled() {
  const s = await setupMarkupShow()
  const db = s.deps.db
  const make = (label: string, major: number, pageIndex: number, y: number) =>
    createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      number: { major, minor: 0 },
      label,
      anchor: anchorAt(s.docId, s.versionId, pageIndex, 100, y),
    })
  const c = await make('c', 5, 1, 700)
  const a = await make('a', 6, 0, 700)
  const b = await make('b', 5, 0, 300)
  return { s, a, b, c }
}

describe('renumberCues', () => {
  test('writes one batch, logs only the changed cues, and leaves unplaced cues and other documents alone', async () => {
    const { s, a, b, c } = await scrambled()
    const db = s.deps.db
    const unplaced = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      number: { major: 77, minor: 0 },
      label: 'free',
    })
    const lineCheck = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      number: { major: 0, minor: 50 },
      anchor: anchorAt(s.docId, s.versionId, 0, 100, 790),
    })
    const other = await addReadyDocument(db, s.show.id, s.owner.id)
    const elsewhere = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
      number: { major: 88, minor: 0 },
      anchor: anchorAt(other.docId, other.versionId, 0),
    })
    const snd = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.SND.id,
      number: { major: 99, minor: 0 },
      anchor: anchorAt(s.docId, s.versionId, 0),
    })

    const before = await db.select().from(changeLog)
    const result = await renumberCues(db, s.actors.owner, {
      departmentId: s.depts.LX.id,
      documentId: s.docId,
    })
    expect(result).toEqual({ changed: 3, flagged: [] })

    const numberOf = async (id: string) => {
      const v = await getCue(db, s.actors.owner, { cueId: id })
      return `${v.major}.${v.minor}`
    }
    expect(await numberOf(a.id)).toBe('10.0')
    expect(await numberOf(b.id)).toBe('11.0')
    expect(await numberOf(c.id)).toBe('12.0')
    expect(await numberOf(unplaced.id)).toBe('77.0')
    expect(await numberOf(lineCheck.id)).toBe('0.50')
    expect(await numberOf(elsewhere.id)).toBe('88.0')
    expect(await numberOf(snd.id)).toBe('99.0')

    const after = (await db.select().from(changeLog)).filter(
      (r) => !before.some((p) => p.seq === r.seq),
    )
    expect(after.map((r) => r.rowId).sort()).toEqual([a.id, b.id, c.id].sort())
    expect(new Set(after.map((r) => r.batchId)).size).toBe(1)
    expect(after.every((r) => r.op === 'update' && r.layer === `department:${s.depts.LX.id}`)).toBe(
      true,
    )

    // running again changes nothing and logs nothing
    const again = await renumberCues(db, s.actors.owner, {
      departmentId: s.depts.LX.id,
      documentId: s.docId,
    })
    expect(again.changed).toBe(0)
    expect(await db.select().from(changeLog)).toHaveLength(before.length + 3)
  })

  test('cues left on an older version are numbered after the current-version cues, never interleaved by page and y', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    const v2 = newId()
    await db.insert(documentVersions).values({
      id: v2,
      showId: s.show.id,
      documentId: s.docId,
      versionNumber: 2,
      originalKey: `test/${v2}.pdf`,
      pageCount: 20,
      uploadedBy: s.owner.id,
      status: 'ready',
    })
    await db.update(documents).set({ currentVersionId: v2 }).where(eq(documents.id, s.docId))
    const make = (label: string, versionId: string, pageIndex: number, y: number) =>
      createCue(db, s.actors.owner, {
        showId: s.show.id,
        departmentId: s.depts.LX.id,
        number: { major: 500, minor: 0 },
        label,
        anchor: anchorAt(s.docId, versionId, pageIndex, 100, y),
      })
    // The older-version cues sit earlier in the script than the current ones.
    await make('old early', s.versionId, 0, 800)
    await make('new late', v2, 3, 100)
    await make('old late', s.versionId, 2, 100)
    await make('new early', v2, 1, 700)
    await renumberCues(db, s.actors.owner, { departmentId: s.depts.LX.id, documentId: s.docId })
    const rows = await listCues(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.LX.id,
    })
    expect(rows.map((r) => `${r.label}:${r.major}`).sort()).toEqual([
      'new early:10',
      'new late:11',
      'old early:12',
      'old late:13',
    ])
  })

  test('the block size applies: three cues at block size 100 are 100, 101, 102', async () => {
    const s = await setupMarkupShow()
    const db = s.deps.db
    for (let i = 0; i < 3; i++) {
      await createCue(db, s.actors.owner, {
        showId: s.show.id,
        departmentId: s.depts.TM.id,
        number: { major: 500 - i, minor: 0 },
        anchor: anchorAt(s.docId, s.versionId, 0, 100, 700 - i * 10),
      })
    }
    const r = await renumberCues(db, s.actors.owner, {
      departmentId: s.depts.TM.id,
      documentId: s.docId,
      blockSize: 100,
    })
    expect(r.changed).toBe(3)
    const rows = await listCues(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.TM.id,
    })
    expect(rows.map((x) => x.major)).toEqual([100, 101, 102])
  })

  test('the LX editor renumbering SND is forbidden and nothing changes', async () => {
    const { s } = await scrambled()
    const db = s.deps.db
    const sndCue = await createCue(db, s.actors.owner, {
      showId: s.show.id,
      departmentId: s.depts.SND.id,
      number: { major: 5, minor: 0 },
      anchor: anchorAt(s.docId, s.versionId, 0),
    })
    const logged = (await db.select().from(changeLog)).length
    expect(
      await code(
        renumberCues(db, s.actors.editorLx, { departmentId: s.depts.SND.id, documentId: s.docId }),
      ),
    ).toBe('forbidden')
    expect((await getCue(db, s.actors.owner, { cueId: sndCue.id })).major).toBe(5)
    expect((await db.select().from(changeLog)).length).toBe(logged)
    // the editor may renumber LX
    expect(
      (
        await renumberCues(db, s.actors.editorLx, {
          departmentId: s.depts.LX.id,
          documentId: s.docId,
        })
      ).changed,
    ).toBe(3)
  })

  test('a viewer, an archived show, a foreign document and a bad block size are refused', async () => {
    const { s } = await scrambled()
    const db = s.deps.db
    const input = { departmentId: s.depts.LX.id, documentId: s.docId }
    expect(await code(renumberCues(db, s.actors.viewer, input))).toBe('forbidden')
    expect(await code(renumberCues(db, s.actors.owner, { ...input, blockSize: 1 }))).toBe('invalid')
    expect(await code(renumberCues(db, s.actors.owner, { ...input, blockSize: 10.5 }))).toBe(
      'invalid',
    )
    expect(
      await code(
        renumberCues(db, s.actors.owner, {
          ...input,
          documentId: '0190c1d2-0000-7000-8000-000000000000',
        }),
      ),
    ).toBe('not_found')
    const { s: s2 } = await scrambled()
    expect(
      await code(
        renumberCues(db, s.actors.owner, { departmentId: s.depts.LX.id, documentId: s2.docId }),
      ),
    ).toBe('not_found')
    expect(
      await code(
        renumberCues(db, s.actors.owner, {
          departmentId: '0190c1d2-0000-7000-8000-000000000000',
          documentId: s.docId,
        }),
      ),
    ).toBe('not_found')
    await updateShow(db, s.actors.owner, { showId: s.show.id, patch: { status: 'archived' } })
    expect(await code(renumberCues(db, s.actors.owner, input))).toBe('forbidden')
  })

  test('MCP renumber_cues returns changed and flagged counts and logs via mcp', async () => {
    const { s, a } = await scrambled()
    const { token } = await createToken(s.deps.db, s.ownerActor, { name: 't', showScope: '*' })
    const client = await connectMcp(s.app, token, { name: 'claude-desktop', version: '1.0.0' })
    clients.push(client)

    const res = await callTool(client, 'renumber_cues', {
      showId: s.show.id,
      department: 'lx',
      documentId: s.docId,
    })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({ changed: 3, flagged: [] })
    const rows = await s.deps.db.select().from(changeLog).where(eq(changeLog.rowId, a.id))
    expect(rows.at(-1)).toMatchObject({ via: 'mcp', op: 'update' })
    expect(rows.at(-1)?.agent).toMatch(/claude-desktop/)

    // by department id, with a block size
    const byId = await callTool(client, 'renumber_cues', {
      departmentId: s.depts.LX.id,
      documentId: s.docId,
      blockSize: 20,
    })
    expect(byId.structuredContent).toEqual({ changed: 3, flagged: [] })
    expect((await getCue(s.deps.db, s.actors.owner, { cueId: a.id })).major).toBe(20)

    // department and departmentId together or neither is invalid; an unknown code names the entry
    expect(resultText(await callTool(client, 'renumber_cues', { documentId: s.docId }))).toMatch(
      /department/i,
    )
    expect(
      resultText(
        await callTool(client, 'renumber_cues', {
          showId: s.show.id,
          department: 'ZZZ',
          documentId: s.docId,
        }),
      ),
    ).toMatch(/ZZZ/)
  })

  test('over MCP the LX editor cannot renumber SND', async () => {
    const { s } = await scrambled()
    const { token } = await createToken(s.deps.db, s.actors.editorLx, { name: 't', showScope: '*' })
    const client = await connectMcp(s.app, token)
    clients.push(client)
    const res = await callTool(client, 'renumber_cues', {
      showId: s.show.id,
      department: 'SND',
      documentId: s.docId,
    })
    expect(res.isError).toBe(true)
    expect(resultText(res)).toMatch(/cannot edit|forbidden/i)
    const ok = await callTool(client, 'renumber_cues', {
      showId: s.show.id,
      department: 'LX',
      documentId: s.docId,
    })
    expect(ok.structuredContent).toEqual({ changed: 3, flagged: [] })
  })
})
