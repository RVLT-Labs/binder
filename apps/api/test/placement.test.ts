import { createReadStream } from 'node:fs'
import { anchorAtMatch, buildWordStream, findQuote, lineCentreY } from '@binder/core'
import { changeLog, cues as cuesTable } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import type { Client } from '@modelcontextprotocol/client'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDocument, createShow, createToken, listCues, updateDocument } from '../src/services'
import { placeCueAtText } from '../src/services/placement'
import { loadVersionText } from '../src/services/wordLayers'
import { setupMarkupShow } from './markupHelpers'
import { callTool, connectMcp, resultText } from './mcpHelpers'
import { missingTools, processVersion } from './processingHelpers'
import { skipWithoutTools } from './tools'

const skip = skipWithoutTools('placement tests', missingTools)

type Setup = Awaited<ReturnType<typeof setupMarkupShow>>
let s: Setup
let libId: string
let libVersionId: string
const clients: Client[] = []

const place = (input: Partial<Parameters<typeof placeCueAtText>[3]> & { quote: string }) =>
  placeCueAtText(s.deps.db, s.deps.blobs, s.actors.owner, {
    showId: s.show.id,
    department: 'TM',
    documentId: libId,
    ...input,
  })

const countCues = async () =>
  (await listCues(s.deps.db, s.actors.owner, { showId: s.show.id })).length

async function streamOf() {
  const text = await loadVersionText(s.deps.db, s.deps.blobs, libVersionId)
  return { text, stream: buildWordStream(text.layers) }
}

beforeAll(async () => {
  s = await setupMarkupShow()
  if (skip) return
  const { document, version } = await createDocument(
    s.deps.db,
    s.deps.blobs,
    s.jobs,
    s.ownerActor,
    {
      showId: s.show.id,
      kind: 'libretto',
      title: 'Pirates',
      file: createReadStream(FIXTURES.librettoPdf),
    },
  )
  libId = document.id
  libVersionId = version.id
  await processVersion({ db: s.deps.db, blobs: s.deps.blobs, jobs: s.jobs }, version.id)
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()))
})

describe.skipIf(skip)('place_cue_at_text', () => {
  test('places a TM cue at a unique quote: page and line y of the match, a quote of at most eight words, status ok', async () => {
    const { text, stream } = await streamOf()
    const page3 = stream.filter((w) => w.pageIndex === 3)
    expect(page3.length).toBeGreaterThan(10)
    // The first line of page index 3, ten words of it (or the whole line), confirmed unique.
    const firstLine = page3.filter((w) => w.lineIndex === page3[0]?.lineIndex)
    const quote = firstLine
      .slice(0, 10)
      .map((w) => w.t)
      .join(' ')
    const matches = findQuote(stream, quote, 'exact')
    expect(matches).toHaveLength(1)

    const before = await countCues()
    const res = await place({ quote })
    expect(res.status).toBe('placed')
    if (res.status !== 'placed') return
    expect(await countCues()).toBe(before + 1)

    const layer = text.layers.get(3)
    expect(layer).toBeDefined()
    const expected = anchorAtMatch(stream, matches[0] as (typeof matches)[0], text)
    const { anchor } = res.cue
    expect(anchor).toMatchObject({
      documentId: libId,
      documentVersionId: libVersionId,
      pageIndex: 3,
      x: expected.x,
      y: lineCentreY(layer as NonNullable<typeof layer>, page3[0]?.lineIndex ?? 0),
      status: 'ok',
    })
    expect(anchor?.text?.quote.split(' ').length).toBeLessThanOrEqual(8)
    expect(anchor?.text).toEqual(expected.text)
    expect(res.cue.departmentCode).toBe('TM')
    expect(res.match.pageIndex).toBe(3)
    expect(res.match.snippet).toContain(firstLine[0]?.t ?? '?')
  })

  test('"Pirate King" is ambiguous: matches listed, nothing written; occurrence 2 places at the second match', async () => {
    const { text, stream } = await streamOf()
    const exact = findQuote(stream, 'Pirate King', 'exact')
    const all = exact.length > 0 ? exact : findQuote(stream, 'Pirate King', 'normalised')
    expect(all.length).toBeGreaterThan(1)

    const before = await countCues()
    const amb = await place({ quote: 'Pirate King' })
    expect(amb.status).toBe('ambiguous')
    if (amb.status !== 'ambiguous') return
    expect(await countCues()).toBe(before)
    expect(amb.matches).toHaveLength(Math.min(all.length, 20))
    expect(amb.matches.map((m) => m.occurrence)).toEqual(amb.matches.map((_, i) => i + 1))
    const pagesOf = all.map((m) => stream[m.start]?.pageIndex)
    expect(amb.matches.map((m) => m.pageIndex)).toEqual(pagesOf.slice(0, 20))
    expect(amb.matches[0]?.snippet.toLowerCase()).toContain('pirate king')

    const second = await place({ quote: 'Pirate King', occurrence: 2 })
    expect(second.status).toBe('placed')
    if (second.status !== 'placed') return
    const want = anchorAtMatch(stream, all[1] as (typeof all)[0], text)
    expect(second.cue.anchor).toMatchObject({ pageIndex: want.pageIndex, x: want.x, y: want.y })
    expect(await countCues()).toBe(before + 1)
  })

  test('nearPageIndex picks the nearest occurrence; ties go to the earlier page', async () => {
    const { stream } = await streamOf()
    const exact = findQuote(stream, 'Pirate King', 'exact')
    const all = exact.length > 0 ? exact : findQuote(stream, 'Pirate King', 'normalised')
    const pageOf = (i: number) => stream[all[i]?.start ?? 0]?.pageIndex ?? -1
    const last = all.length - 1
    expect(pageOf(last)).toBeGreaterThan(pageOf(0))

    const nearLast = await place({ quote: 'Pirate King', nearPageIndex: pageOf(last) + 50 })
    expect(nearLast.status).toBe('placed')
    if (nearLast.status === 'placed') expect(nearLast.match.pageIndex).toBe(pageOf(last))

    const nearFirst = await place({ quote: 'Pirate King', nearPageIndex: 0 })
    expect(nearFirst.status).toBe('placed')
    if (nearFirst.status === 'placed') expect(nearFirst.match.pageIndex).toBe(pageOf(0))
  })

  test('normalised matching finds a quote the exact pass misses', async () => {
    const res = await place({ quote: 'frederic from to-day you rank' })
    expect(res.status).toBe('placed')
    if (res.status === 'placed') expect(res.match.snippet.toLowerCase()).toContain('rank')
  })

  test('an out-of-range occurrence is invalid', async () => {
    await expect(place({ quote: 'Pirate King', occurrence: 9999 })).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  test('an unknown quote is not_found naming the document', async () => {
    const before = await countCues()
    await expect(place({ quote: 'zzzz qqqq nonexistent phrase' })).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('Pirates'),
    })
    expect(await countCues()).toBe(before)
  })

  test('a document whose current version is not ready is invalid', async () => {
    const { document } = await createDocument(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
      showId: s.show.id,
      kind: 'libretto',
      title: 'Unprocessed',
      file: createReadStream(FIXTURES.librettoPdf),
    })
    await expect(place({ quote: 'Pirate', documentId: document.id })).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  test('the LX editor cannot place a TM cue (forbidden), and nothing is written', async () => {
    const before = await countCues()
    await expect(
      placeCueAtText(s.deps.db, s.deps.blobs, s.actors.editorLx, {
        showId: s.show.id,
        department: 'TM',
        documentId: libId,
        quote: 'rocky seashore',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await countCues()).toBe(before)
    const lx = await placeCueAtText(s.deps.db, s.deps.blobs, s.actors.editorLx, {
      showId: s.show.id,
      department: 'LX',
      documentId: libId,
      quote: 'rocky seashore',
    })
    expect(lx.status).toBe('placed')
  })

  test('an unknown department is invalid; the department id works as well as the code', async () => {
    await expect(place({ quote: 'rocky seashore', department: 'NOPE' })).rejects.toMatchObject({
      code: 'invalid',
    })
    const byId = await place({ quote: 'rocky seashore', department: s.depts.SND.id })
    expect(byId.status).toBe('placed')
    if (byId.status === 'placed') expect(byId.cue.departmentCode).toBe('SND')
  })

  test('a non-member gets not_found', async () => {
    await expect(
      placeCueAtText(
        s.deps.db,
        s.deps.blobs,
        { userId: s.outsider.id, via: 'web', agent: null },
        { showId: s.show.id, department: 'TM', quote: 'rocky seashore' },
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  test('the document defaults to the first libretto by sort order; a show with no documents is invalid', async () => {
    // markupHelpers' fake libretto sorts first; move it back so the processed one leads.
    await updateDocument(s.deps.db, s.ownerActor, {
      documentId: s.docId,
      patch: { sortOrder: 99 },
    })
    const res = await placeCueAtText(s.deps.db, s.deps.blobs, s.actors.owner, {
      showId: s.show.id,
      department: 'TM',
      quote: 'rocky seashore',
    })
    expect(res.status).toBe('placed')
    if (res.status === 'placed') expect(res.cue.anchor?.documentId).toBe(libId)

    const other = await setupMarkupShow()
    const emptyShow = await createShow(other.deps.db, other.ownerActor, {
      organisationId: other.show.organisationId,
      title: 'Empty',
    })
    await expect(
      placeCueAtText(other.deps.db, other.deps.blobs, other.ownerActor, {
        showId: emptyShow.id,
        department: 'TM',
        quote: 'x',
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  test('the placed cue is logged once with an ok anchor on the current version', async () => {
    const res = await place({ quote: 'Pour, O pour the pirate sherry', occurrence: 1 })
    expect(res.status).toBe('placed')
    if (res.status !== 'placed') return
    const rows = await s.deps.db.select().from(changeLog).where(eq(changeLog.rowId, res.cue.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ op: 'insert', via: 'web' })
    const [row] = await s.deps.db.select().from(cuesTable).where(eq(cuesTable.id, res.cue.id))
    expect(row?.anchor).toMatchObject({ status: 'ok', documentVersionId: libVersionId })
  })

  test('an explicit number, label, type and notes are carried onto the cue', async () => {
    const res = await place({
      quote: 'rocky seashore',
      number: { major: 5, minor: 50 },
      label: 'Sunrise',
      type: 'warn',
      notes: 'slow',
    })
    expect(res.status).toBe('placed')
    if (res.status !== 'placed') return
    expect(res.cue).toMatchObject({
      major: 5,
      minor: 50,
      label: 'Sunrise',
      type: 'warn',
      notes: 'slow',
      display: '5.50',
    })
  })

  describe('over MCP', () => {
    test('MCP place_cue_at_text places the cue and logs via mcp with the agent', async () => {
      const { token } = await createToken(s.deps.db, s.ownerActor, { name: 't', showScope: '*' })
      const client = await connectMcp(s.app, token, { name: 'claude-desktop', version: '1.0.0' })
      clients.push(client)
      const res = await callTool(client, 'place_cue_at_text', {
        showId: s.show.id,
        department: 'tm',
        documentId: libId,
        quote: 'rocky seashore',
        number: '7.5',
        label: 'via mcp',
      })
      expect(res.isError).toBeFalsy()
      expect(res.structuredContent?.status).toBe('placed')
      const cue = res.structuredContent?.cue
      expect(cue).toMatchObject({ departmentCode: 'TM', display: '7.50', label: 'via mcp' })
      expect(cue.anchor.status).toBe('ok')
      const rows = await s.deps.db.select().from(changeLog).where(eq(changeLog.rowId, cue.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ via: 'mcp', op: 'insert' })
      expect(rows[0]?.agent).toMatch(/claude-desktop/)

      const amb = await callTool(client, 'place_cue_at_text', {
        showId: s.show.id,
        department: 'TM',
        documentId: libId,
        quote: 'Pirate King',
      })
      expect(amb.isError).toBeFalsy()
      expect(amb.structuredContent?.status).toBe('ambiguous')
      expect(amb.structuredContent?.matches.length).toBeGreaterThan(1)

      const bad = await callTool(client, 'place_cue_at_text', {
        showId: s.show.id,
        department: 'TM',
        documentId: libId,
        quote: 'zzzz nothing like this',
      })
      expect(bad.isError).toBe(true)
      expect(resultText(bad)).toMatch(/Pirates/)
    })
  })
})
