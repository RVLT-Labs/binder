import { readFileSync } from 'node:fs'
import type { Anchor, WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { versionFromLines } from '../../test/textLayers'
import { caretX } from '../markup/caret'
import { buildWordStream, findQuote } from './quote'
import { reanchor, reanchorAll } from './reanchor'
import { cutQuote, lineCentreY, snapToLine } from './snap'
import type { VersionText } from './types'

const pirates = readFileSync(
  new URL('../../../../fixtures/public/pirates.txt', import.meta.url),
  'utf8',
).split('\n')

const LEFT = 72
const OFFSET = 15 // an anchor's x sits this far right of its line's left edge
const old = versionFromLines(pirates, { versionId: 'v1' })
const oldStream = buildWordStream(old.layers)

interface Picked {
  anchor: Anchor
  line: number
}

/** First line at or after `from` whose first-eight-words quote is unique both exactly and normalised. */
function pickAnchor(
  version: VersionText,
  stream: ReturnType<typeof buildWordStream>,
  from: number,
  used: Set<number>,
  perPage = 48,
): Picked {
  for (let line = from; line < pirates.length; line++) {
    if (used.has(line)) continue
    const pageIndex = Math.floor(line / perPage)
    const layer = version.layers.get(pageIndex) as WordLayer
    const row = line % perPage
    const y = lineCentreY(layer, row)
    if (Number.isNaN(y)) continue
    const snapped = snapToLine(layer, { x: LEFT, y })
    if (!snapped) continue
    const { quote } = snapped.text
    if (findQuote(stream, quote, 'exact').length !== 1) continue
    if (findQuote(stream, quote, 'normalised').length !== 1) continue
    used.add(line)
    return {
      line,
      anchor: {
        documentId: 'doc',
        documentVersionId: version.versionId,
        pageIndex,
        x: LEFT + OFFSET,
        y: snapped.y,
        text: snapped.text,
        status: 'ok',
      },
    }
  }
  throw new Error('no unique line')
}

function pickMany(starts: number[]): Picked[] {
  const used = new Set<number>()
  return starts.map((s) => pickAnchor(old, oldStream, s, used))
}

/** 50 evenly spaced lines, plus a few chosen so the edits below hit them. */
const picked = pickMany([
  ...Array.from({ length: 50 }, (_, k) => Math.floor((k * pirates.length) / 50)),
  205,
  220,
  238,
  440,
  460,
])

const textless = (pageIndex: number, status: Anchor['status'] = 'ok'): Anchor => ({
  documentId: 'doc',
  documentVersionId: 'v1',
  pageIndex,
  x: 200,
  y: 400,
  status,
})
const lastPage = old.pageCount - 1
const noText = [textless(0), textless(60), textless(lastPage)]

const all = [...picked.map((p) => p.anchor), ...noText]

/** Where line `i` of the old text sits in `to`, given its line index there. */
function lineAt(to: VersionText, newLine: number, perPage = 48) {
  const pageIndex = Math.floor(newLine / perPage)
  const layer = to.layers.get(pageIndex) as WordLayer
  const row = newLine % perPage
  return { pageIndex, y: lineCentreY(layer, row) }
}

function edit(fn: (l: string[]) => void): string[] {
  const copy = [...pirates]
  fn(copy)
  return copy
}

function expectPlaced(
  results: Anchor[],
  to: VersionText,
  mapLine: (oldLine: number) => number | null,
  perPage = 48,
) {
  picked.forEach((p, k) => {
    const r = results[k] as Anchor
    const newLine = mapLine(p.line)
    if (newLine === null) return
    const where = lineAt(to, newLine, perPage)
    expect(r.documentVersionId).toBe(to.versionId)
    expect(r.status).toBe('ok')
    expect(r.pageIndex).toBe(where.pageIndex)
    expect(r.y).toBeCloseTo(where.y, 6)
    expect(r.text?.quote).toBe(p.anchor.text?.quote)
    const layer = to.layers.get(where.pageIndex) as WordLayer
    expect(layer.words[r.text?.wordStart as number]?.t).toBe(p.anchor.text?.quote.split(' ')[0])
  })
}

describe('reanchor against the full libretto', () => {
  test('an identical version keeps every anchor ok at the same position', () => {
    const to = versionFromLines(pirates, { versionId: 'v2' })
    const out = reanchorAll(all.slice(0, picked.length), old, to)
    out.forEach((r, k) => {
      expect(r).toEqual({ ...all[k], documentVersionId: 'v2' })
    })
    // The three anchors without text: equal page counts -> approximate at the same spot.
    const plain = reanchorAll(noText, old, to)
    plain.forEach((r, k) => {
      expect(r).toEqual({ ...noText[k], documentVersionId: 'v2', status: 'approximate' })
    })
  })

  test('cutting lines 201-240 keeps the others ok on their new page and line; cut quotes fall back by page count', () => {
    const cutFrom = 200
    const cutTo = 240
    const to = versionFromLines(
      edit((l) => l.splice(cutFrom, cutTo - cutFrom)),
      { versionId: 'v2' },
    )
    expect(to.pageCount).toBeLessThan(old.pageCount)
    const out = reanchorAll(all, old, to)
    expect(out).toHaveLength(all.length)

    expectPlaced(out, to, (i) => (i >= cutFrom && i < cutTo ? null : i < cutFrom ? i : i - 40))

    const cut = picked
      .map((p, k) => ({ p, r: out[k] as Anchor }))
      .filter(({ p }) => p.line >= cutFrom && p.line < cutTo)
    expect(cut.length).toBeGreaterThanOrEqual(3)
    for (const { p, r } of cut) {
      // Page counts differ and the old page still exists: same page, same spot, unresolved, text unbound.
      expect(r.status).toBe('unresolved')
      expect(r.pageIndex).toBe(p.anchor.pageIndex)
      expect(r.x).toBe(p.anchor.x)
      expect(r.y).toBe(p.anchor.y)
      expect(r.text).toEqual({ quote: p.anchor.text?.quote, wordStart: -1, wordEnd: -1 })
    }
    // Text-less: the first two stay on their pages, the old last page lands on the new last page.
    expect(out[picked.length]).toMatchObject({ pageIndex: 0, status: 'unresolved' })
    expect(out[picked.length + 1]).toMatchObject({ pageIndex: 60, status: 'unresolved' })
    expect(out[picked.length + 2]).toMatchObject({
      pageIndex: to.pageCount - 1,
      status: 'unresolved',
    })
  })

  test('adding 30 lines shifts later anchors and keeps them ok', () => {
    const at = 300
    const fresh = Array.from({ length: 30 }, (_, k) => `ADDED zebra${k} quokka${k} wombat`)
    const to = versionFromLines(
      edit((l) => l.splice(at, 0, ...fresh)),
      { versionId: 'v2' },
    )
    const out = reanchorAll(all, old, to)
    expectPlaced(out, to, (i) => (i < at ? i : i + 30))
    expect(picked.some((p) => p.line >= at)).toBe(true)
    // At least one anchor changed page.
    expect(
      out.some((r, k) => k < picked.length && r.pageIndex !== (all[k] as Anchor).pageIndex),
    ).toBe(true)
  })

  test('inserting a page after page 5 moves later anchors one page on, ok', () => {
    const at = 6 * 48
    const fresh = Array.from({ length: 48 }, (_, k) => `INSERTED page line${k} ibis`)
    const to = versionFromLines(
      edit((l) => l.splice(at, 0, ...fresh)),
      { versionId: 'v2' },
    )
    expect(to.pageCount).toBe(old.pageCount + 1)
    const out = reanchorAll(all, old, to)
    expectPlaced(out, to, (i) => (i < at ? i : i + 48))
    picked.forEach((p, k) => {
      const r = out[k] as Anchor
      expect(r.pageIndex).toBe(p.line >= at ? p.anchor.pageIndex + 1 : p.anchor.pageIndex)
      expect(r.y).toBeCloseTo(p.anchor.y, 6)
    })
  })

  test('removing page 10: its quotes are gone, so its anchors stay on page 10 unresolved; a text-less anchor on the old last page lands on the new last page, unresolved', () => {
    const page = 9 // page 10, zero-based
    const to = versionFromLines(
      edit((l) => l.splice(page * 48, 48)),
      { versionId: 'v2' },
    )
    expect(to.pageCount).toBe(old.pageCount - 1)
    const out = reanchorAll(all, old, to)
    expectPlaced(out, to, (i) => {
      const p = Math.floor(i / 48)
      return p === page ? null : p < page ? i : i - 48
    })
    const gone = picked
      .map((p, k) => ({ p, r: out[k] as Anchor }))
      .filter(({ p }) => p.anchor.pageIndex === page)
    expect(gone.length).toBeGreaterThanOrEqual(2)
    for (const { r } of gone) {
      expect(r.pageIndex).toBe(page)
      expect(r.status).toBe('unresolved')
      expect(r.text?.wordStart).toBe(-1)
    }
    const last = out[out.length - 1] as Anchor
    expect(last.pageIndex).toBe(to.pageCount - 1)
    expect(last.status).toBe('unresolved')
  })

  test("different margins and 44 lines per page: all ok, x keeps its offset from the line's left edge", () => {
    const to = versionFromLines(pirates, { versionId: 'v2', linesPerPage: 44, left: 100 })
    expect(to.pageCount).toBe(Math.ceil(pirates.length / 44))
    const out = reanchorAll(all, old, to)
    expectPlaced(out, to, (i) => i, 44)
    // old a.x = oldLineLeft + 15 -> new x = newLineLeft + 15 (left 72 -> 100)
    picked.forEach((p, k) => {
      expect(p.anchor.x).toBe(LEFT + OFFSET)
      expect((out[k] as Anchor).x).toBeCloseTo(100 + OFFSET, 6)
    })
  })
})

describe('reanchor on small texts', () => {
  const filler = (n: number, tag: string) =>
    Array.from({ length: n }, (_, k) => `${tag} filler${k} text`)
  const base = [
    ...filler(12, 'a'),
    'the lantern glows softly',
    ...filler(20, 'b'),
    'closing words here',
  ]
  const from = versionFromLines(base, { versionId: 'v1', linesPerPage: 10 })
  const quoteAnchor = (line: number, quote: string): Anchor => {
    const layer = from.layers.get(Math.floor(line / 10)) as WordLayer
    return {
      documentId: 'doc',
      documentVersionId: 'v1',
      pageIndex: Math.floor(line / 10),
      x: LEFT,
      y: lineCentreY(layer, line % 10),
      text: { quote, wordStart: 0, wordEnd: quote.split(' ').length - 1 },
      status: 'ok',
    }
  }

  test('a quote that now appears twice picks the nearer relative position, approximate', () => {
    const doubled = [...base]
    doubled.splice(30, 0, 'the lantern glows softly') // second copy near the end
    const to = versionFromLines(doubled, { versionId: 'v2', linesPerPage: 10 })
    // The anchor was at line 12 (early): the early copy (line 12) is nearer than the one at line 30.
    const early = reanchor(quoteAnchor(12, 'the lantern glows softly'), from, to)
    expect(early.status).toBe('approximate')
    expect(early.pageIndex).toBe(1)
    expect(early.y).toBeCloseTo(lineCentreY(to.layers.get(1) as WordLayer, 2), 6)
    // The same anchor moved to the end of the old text picks the late copy.
    const lateFrom = { ...quoteAnchor(12, 'the lantern glows softly'), pageIndex: 3, y: 300 }
    const late = reanchor(lateFrom, from, to)
    expect(late.status).toBe('approximate')
    expect(late.pageIndex).toBe(3)
    expect(late.y).toBeCloseTo(lineCentreY(to.layers.get(3) as WordLayer, 0), 6)
    expect(early.text?.wordStart).toBeGreaterThanOrEqual(0)
  })

  test('a case change matches normalised, approximate', () => {
    const shouted = [...base]
    shouted[12] = 'THE LANTERN GLOWS SOFTLY!'
    const to = versionFromLines(shouted, { versionId: 'v2', linesPerPage: 10 })
    const r = reanchor(quoteAnchor(12, 'the lantern glows softly'), from, to)
    expect(r.status).toBe('approximate')
    expect(r.pageIndex).toBe(1)
    expect(r.y).toBeCloseTo(lineCentreY(to.layers.get(1) as WordLayer, 2), 6)
    expect(r.text).toEqual({ quote: 'the lantern glows softly', wordStart: 6, wordEnd: 9 })
  })

  test('equally near matches: the earliest wins', () => {
    const dims = { versionId: 'v', linesPerPage: 5, top: 763, height: 1024 }
    const lines = (at: number[]) =>
      Array.from({ length: 20 }, (_, k) => (at.includes(k) ? 'echo of the bell' : `pad${k} x`))
    const f = versionFromLines(lines([5]), dims)
    const t = versionFromLines(lines([0, 10]), { ...dims, versionId: 'v2' })
    const a: Anchor = {
      documentId: 'doc',
      documentVersionId: 'v',
      pageIndex: 1,
      x: LEFT,
      y: lineCentreY(f.layers.get(1) as WordLayer, 0),
      text: { quote: 'echo of the bell', wordStart: 0, wordEnd: 3 },
      status: 'ok',
    }
    const r = reanchor(a, f, t)
    expect(r.status).toBe('approximate')
    expect(r.pageIndex).toBe(0)
  })

  test('an exact single match is ok, and the result keeps documentId', () => {
    const to = versionFromLines([...filler(3, 'z'), ...base], { versionId: 'v2', linesPerPage: 10 })
    const r = reanchor(quoteAnchor(12, 'the lantern glows softly'), from, to)
    expect(r.status).toBe('ok')
    expect(r.documentId).toBe('doc')
    expect(r.documentVersionId).toBe('v2')
    expect(r.pageIndex).toBe(1)
    expect(r.y).toBeCloseTo(lineCentreY(to.layers.get(1) as WordLayer, 5), 6)
  })

  test('without text: equal page counts approximate, different unresolved, past the end the last page', () => {
    const same = versionFromLines(base, { versionId: 'v2', linesPerPage: 10 })
    const more = versionFromLines([...base, ...filler(15, 'c')], {
      versionId: 'v2',
      linesPerPage: 10,
    })
    const fewer = versionFromLines(base.slice(0, 20), { versionId: 'v2', linesPerPage: 10 })
    const a = { ...textless(1), x: 150, y: 300 }

    const eq = reanchor(a, from, same)
    expect(eq).toMatchObject({
      pageIndex: 1,
      x: 150,
      y: 300,
      status: 'approximate',
      documentVersionId: 'v2',
    })
    expect(eq.text).toBeUndefined()

    expect(reanchor(a, from, more)).toMatchObject({
      pageIndex: 1,
      x: 150,
      y: 300,
      status: 'unresolved',
    })
    expect(reanchor({ ...a, pageIndex: 3 }, from, fewer)).toMatchObject({
      pageIndex: 1,
      x: 150,
      y: 300,
      status: 'unresolved',
    })
  })

  test('a quote that is not found keeps the quote unbound and falls back by page', () => {
    const same = versionFromLines(base, { versionId: 'v2', linesPerPage: 10 })
    const r = reanchor(quoteAnchor(5, 'vanished entirely'), from, same)
    expect(r.status).toBe('approximate')
    expect(r.pageIndex).toBe(0)
    expect(r.text).toEqual({ quote: 'vanished entirely', wordStart: -1, wordEnd: -1 })
  })

  test('a positional match keeps an earlier worse status', () => {
    const sameCount = versionFromLines(base, { versionId: 'v2', linesPerPage: 10 })
    const nt = textless(1)
    expect(reanchor({ ...nt, status: 'unresolved' }, from, sameCount).status).toBe('unresolved')
    expect(reanchor({ ...nt, status: 'approximate' }, from, sameCount).status).toBe('approximate')
    expect(reanchor({ ...nt, status: 'ok' }, from, sameCount).status).toBe('approximate')
  })

  test('the position is clamped to the target page, then to the source page, and not at all with neither', () => {
    const wide = { ...textless(1), x: 700, y: 900 }
    const small = (dims: { width: number | null; height: number | null } | null): VersionText => {
      const v = versionFromLines(base, { versionId: 'v2', linesPerPage: 10 })
      return dims ? { ...v, pages: v.pages.map(() => dims) } : v
    }
    // Target dims win.
    expect(reanchor(wide, from, small({ width: 300, height: 400 }))).toMatchObject({
      x: 300,
      y: 400,
    })
    // Target null -> the source page's dimensions (595 x 842).
    expect(reanchor(wide, from, small({ width: null, height: null }))).toMatchObject({
      x: 595,
      y: 842,
    })
    // Both null -> unclamped.
    const nullFrom: VersionText = {
      ...from,
      pages: from.pages.map(() => ({ width: null, height: null })),
    }
    expect(reanchor(wide, nullFrom, small({ width: null, height: null }))).toMatchObject({
      x: 700,
      y: 900,
    })
    // Negative coordinates clamp to zero.
    expect(reanchor({ ...wide, x: -5, y: -9 }, from, small(null))).toMatchObject({ x: 0, y: 0 })
  })
})

describe('reanchor when the quote appeared more than once in the old text', () => {
  const REFRAIN = 'echo of the bell'
  const PER_PAGE = 4
  const dims = { linesPerPage: PER_PAGE }
  // The refrain at lines 1 and 4, with different words before it and the same words after it.
  const song = [
    'verse one opens here', // 0
    REFRAIN, // 1: first copy
    'and the sea goes on', // 2
    'verse two follows now', // 3
    REFRAIN, // 4: second copy
    'and the sea goes on', // 5
    'a closing word or two', // 6
    'last line of the song', // 7
  ]
  const from = versionFromLines(song, { versionId: 'v1', ...dims })
  const without = (start: number, count: number) =>
    versionFromLines(
      song.filter((_, i) => i < start || i >= start + count),
      { versionId: 'v2', ...dims },
    )

  /** An anchor on the refrain at `line`, the way snapping or place_cue_at_text records it. */
  const onRefrain = (line: number, v: VersionText = from, perPage = PER_PAGE): Anchor => {
    const pageIndex = Math.floor(line / perPage)
    const layer = v.layers.get(pageIndex) as WordLayer
    const row = line % perPage
    const wordStart = layer.lines[row]?.[0] as number
    return {
      documentId: 'doc',
      documentVersionId: v.versionId,
      pageIndex,
      x: LEFT,
      y: lineCentreY(layer, row),
      text: { quote: REFRAIN, wordStart, wordEnd: wordStart + 3 },
      status: 'ok',
    }
  }
  const yAt = (v: VersionText, line: number) =>
    lineCentreY(v.layers.get(Math.floor(line / PER_PAGE)) as WordLayer, line % PER_PAGE)

  test('the copy the anchor was on is cut and the other survives: approximate on the survivor, not ok', () => {
    const to = without(3, 3) // verse two, its refrain and the line after are cut
    const r = reanchor(onRefrain(4), from, to)
    expect(r.status).toBe('approximate')
    // A suggested target: the surviving copy, with the text still bound to it.
    expect(r.documentVersionId).toBe('v2')
    expect(r.pageIndex).toBe(0)
    expect(r.y).toBeCloseTo(yAt(to, 1), 6)
    expect(r.text).toEqual({ quote: REFRAIN, wordStart: 4, wordEnd: 7 })
  })

  test('the other copy is cut and the anchored one survives: still ok', () => {
    const to = without(0, 3) // verse one, its refrain and the line after are cut
    const r = reanchor(onRefrain(4), from, to)
    expect(r.status).toBe('ok')
    expect(r.pageIndex).toBe(0)
    expect(r.y).toBeCloseTo(yAt(to, 1), 6)
  })

  test('the first copy was anchored and it survives: ok', () => {
    const to = without(3, 3)
    const r = reanchor(onRefrain(1), from, to)
    expect(r.status).toBe('ok')
    expect(r.pageIndex).toBe(0)
    expect(r.y).toBeCloseTo(yAt(to, 1), 6)
  })

  test('the first copy was anchored and the second survives: approximate', () => {
    const to = without(0, 3)
    expect(reanchor(onRefrain(1), from, to).status).toBe('approximate')
  })

  test('reanchorAll flags the same anchors as reanchor does', () => {
    const to = without(3, 3)
    const anchors = [onRefrain(1), onRefrain(4)]
    expect(reanchorAll(anchors, from, to).map((r) => r.status)).toEqual(['ok', 'approximate'])
  })

  test('copies with identical neighbours cannot be told apart, so the survivor is approximate', () => {
    const block = ['verse one opens here', REFRAIN, 'and the sea goes on', 'a closing word or two']
    const twice = versionFromLines([...block, ...block, 'last line of the song'], {
      versionId: 'v1',
      ...dims,
    })
    const once = versionFromLines([...block, 'last line of the song'], {
      versionId: 'v2',
      ...dims,
    })
    // Whichever copy the anchor was on, the text alone cannot say which one was kept.
    expect(reanchor(onRefrain(1, twice), twice, once).status).toBe('approximate')
    expect(reanchor(onRefrain(5, twice), twice, once).status).toBe('approximate')
  })

  test('a quote that was unique in the old text is unaffected: ok on the one match', () => {
    const to = without(3, 3)
    const unique = {
      ...onRefrain(7),
      text: { quote: 'last line of the song', wordStart: 0, wordEnd: 4 },
    }
    expect(reanchor(unique, from, to).status).toBe('ok')
  })
})

describe('reanchorAll', () => {
  test('never drops an anchor and agrees with reanchor one by one', () => {
    const to = versionFromLines(
      edit((l) => l.splice(200, 40)),
      { versionId: 'v2' },
    )
    const out = reanchorAll(all, old, to)
    expect(out).toHaveLength(all.length)
    out.forEach((r, k) => {
      expect(r).toEqual(reanchor(all[k] as Anchor, old, to))
    })
    expect(reanchorAll([], old, to)).toEqual([])
  })

  test('a malformed anchor degrades without failing the run or the others', () => {
    const to = versionFromLines(pirates, { versionId: 'v2' })
    const good = (picked[3] as Picked).anchor
    const malformed: Anchor[] = [
      {
        ...good,
        pageIndex: 9999,
        text: { quote: 'no such words anywhere', wordStart: 5, wordEnd: 6 },
      },
      { ...good, text: { quote: '', wordStart: 0, wordEnd: 0 } },
      { ...good, text: { quote: '   ', wordStart: 0, wordEnd: 0 } },
      { ...good, pageIndex: -4, text: undefined },
      { ...good, x: Number.NaN, y: Number.POSITIVE_INFINITY, text: undefined },
      {
        ...good,
        text: {
          ...(good.text as object),
          quote: good.text?.quote as string,
          wordStart: 99999,
          wordEnd: 100000,
        },
      } as Anchor,
    ]
    const input = [good, ...malformed, good]
    const out = reanchorAll(input, old, to)
    expect(out).toHaveLength(input.length)
    expect(out[0]).toEqual({ ...good, documentVersionId: 'v2' })
    expect(out.at(-1)).toEqual({ ...good, documentVersionId: 'v2' })
    // Past the end of the target: last page, unresolved, text unbound.
    expect(out[1]).toMatchObject({ pageIndex: to.pageCount - 1, status: 'unresolved' })
    expect(out[1]?.text).toEqual({ quote: 'no such words anywhere', wordStart: -1, wordEnd: -1 })
    // Empty and blank quotes behave as no match: equal counts -> approximate on the same page.
    expect(out[2]).toMatchObject({ pageIndex: good.pageIndex, status: 'approximate' })
    expect(out[3]).toMatchObject({ pageIndex: good.pageIndex, status: 'approximate' })
    expect(out[4]).toMatchObject({ pageIndex: 0, status: 'approximate' })
    for (const r of out.slice(1, 7)) {
      expect(Number.isFinite(r.x)).toBe(true)
      expect(Number.isFinite(r.y)).toBe(true)
    }
    // A stale wordStart still finds the quote; x just keeps the target's own offset.
    expect(out[6]?.status).toBe('ok')
    expect(out[6]?.pageIndex).toBe(good.pageIndex)
  })

  test('a failure while re-anchoring one anchor leaves the others placed and that one unresolved', () => {
    const to = versionFromLines(
      edit((l) => l.splice(200, 40)),
      { versionId: 'v2' },
    )
    const badPage = (picked[10] as Picked).anchor.pageIndex
    const layers = new Map(old.layers)
    layers.get = (k: number) => {
      if (k === badPage) throw new Error('boom')
      return Map.prototype.get.call(layers, k)
    }
    const flaky = { ...old, layers } as VersionText
    const out = reanchorAll(all, flaky, to)
    const healthy = reanchorAll(all, old, to)
    expect(out).toHaveLength(all.length)
    all.forEach((a, k) => {
      if (a.pageIndex === badPage && a.text) {
        expect(out[k]?.status).toBe('unresolved')
        expect(out[k]?.pageIndex).toBe(badPage)
        expect(out[k]?.text?.wordStart).toBe(-1)
      } else {
        expect(out[k]).toEqual(healthy[k])
      }
    })
    expect(
      out.some((r, k) => (all[k] as Anchor).pageIndex === badPage && r.status === 'unresolved'),
    ).toBe(true)
  })

  test('versions without layers or pages do not throw', () => {
    const bare: VersionText = {
      versionId: 'v2',
      documentId: 'doc',
      pageCount: 0,
      pages: [],
      layers: new Map(),
    }
    const out = reanchorAll(all.slice(0, 5), bare, bare)
    expect(out).toHaveLength(5)
    for (const r of out) {
      expect(r.status).toBe('unresolved')
      expect(r.pageIndex).toBe(0)
    }
    const toNoLayers = { ...old, versionId: 'v3', layers: new Map() } as VersionText
    const out2 = reanchorAll(all.slice(0, 5), old, toNoLayers)
    expect(out2.map((r) => r.status)).toEqual([
      'approximate',
      'approximate',
      'approximate',
      'approximate',
      'approximate',
    ])
  })

  test('500 anchors across the full libretto re-anchor quickly', () => {
    const used = new Set<number>()
    const many: Anchor[] = []
    for (let k = 0; k < 500; k++) {
      many.push(pickAnchor(old, oldStream, Math.floor((k * pirates.length) / 500), used).anchor)
    }
    const to = versionFromLines(
      edit((l) => {
        l.splice(1000, 60)
        l.splice(3000, 0, ...Array.from({ length: 20 }, (_, k) => `ADDED zebra${k} quokka`))
      }),
      { versionId: 'v2' },
    )
    const t0 = performance.now()
    const out = reanchorAll(many, old, to)
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(5000)
    expect(out).toHaveLength(500)
    const ok = out.filter((r) => r.status === 'ok').length
    expect(ok).toBeGreaterThan(400)
    expect(out.every((r) => r.documentVersionId === 'v2')).toBe(true)
  })
})

describe('reanchor and the cue mark', () => {
  const words = (prefix: string, n: number): string[] =>
    Array.from({ length: n }, (_, k) => `${prefix}${k}`)
  const fill = (n: number, tag: string): string[] =>
    Array.from({ length: n }, (_, k) => `${tag}${k} pad`)
  const dims = { linesPerPage: 20 }

  /** An anchor on the first word of `line` of `version`, quoting `count` words. */
  function anchorOn(
    version: VersionText,
    line: number,
    count: number,
    extra: Partial<Anchor> = {},
  ): Anchor {
    const pageIndex = Math.floor(line / dims.linesPerPage)
    const layer = version.layers.get(pageIndex) as WordLayer
    const indices = layer.lines[line % dims.linesPerPage] as number[]
    const first = indices[0] as number
    const picked = indices.slice(0, count)
    return {
      documentId: 'doc',
      documentVersionId: version.versionId,
      pageIndex,
      x: LEFT,
      y: lineCentreY(layer, line % dims.linesPerPage),
      text: {
        quote: picked.map((i) => (layer.words[i] as { t: string }).t).join(' '),
        wordStart: first,
        wordEnd: picked.at(-1) as number,
      },
      status: 'ok',
      ...extra,
    }
  }

  const baseLines = [...fill(5, 'a'), 'lantern! glows softly', ...fill(10, 'b')]
  const from1 = versionFromLines(baseLines, { versionId: 'v1', ...dims })

  test("a line keeps its offset, clamped to the matched word's new length, and its x is the new caret x", () => {
    const oldLayer = from1.layers.get(0) as WordLayer
    const oldWord = oldLayer.words[
      (oldLayer.lines[5] as number[])[0] as number
    ] as WordLayer['words'][number]
    const lineAnchor = (offset: number): Anchor => ({
      ...anchorOn(from1, 5, 3, { mark: 'line', tag: { dx: 4, dy: -2 } }),
      x: caretX(oldWord, offset),
      text: {
        ...(anchorOn(from1, 5, 3).text as NonNullable<Anchor['text']>),
        offset,
      },
    })
    // An unchanged quote moved down a page-line: the offset is kept and x follows the new word.
    const moved = versionFromLines([...fill(2, 'z'), ...baseLines], { versionId: 'v2', ...dims })
    const kept = reanchor(lineAnchor(4), from1, moved)
    const newLayer = moved.layers.get(0) as WordLayer
    const newWord = newLayer.words[kept.text?.wordStart as number] as {
      t: string
      x: number
      w: number
    }
    expect(kept.status).toBe('ok')
    expect(newWord.t).toBe('lantern!')
    expect(kept.text?.offset).toBe(4)
    expect(kept.x).toBeCloseTo(caretX(newWord, 4), 6)
    expect(kept.mark).toBe('line')
    expect(kept.tag).toEqual({ dx: 4, dy: -2 })

    // A normalised match onto a shorter word clamps the offset to the new length.
    const shorter = versionFromLines(
      baseLines.map((l) => (l.startsWith('lantern') ? 'Lantern glows softly' : l)),
      { versionId: 'v3', ...dims },
    )
    const clamped = reanchor(lineAnchor(8), from1, shorter)
    const shortWord = (shorter.layers.get(0) as WordLayer).words[
      clamped.text?.wordStart as number
    ] as {
      t: string
      x: number
      w: number
    }
    expect(clamped.status).toBe('approximate')
    expect(clamped.text?.offset).toBe(7)
    expect(clamped.x).toBeCloseTo(shortWord.x + shortWord.w, 6)
  })

  test('a pointer without an offset gets no offset and the usual line-relative x', () => {
    const pointer = anchorOn(from1, 5, 3, { mark: 'pointer', x: LEFT + OFFSET })
    const moved = versionFromLines([...fill(2, 'z'), ...baseLines], { versionId: 'v2', ...dims })
    const r = reanchor(pointer, from1, moved)
    expect(r.text).not.toHaveProperty('offset')
    expect(r.mark).toBe('pointer')
  })

  test('a line whose quote is not found goes positional: the text is unbound, the offset is dropped, mark and tag survive, and the status is approximate or unresolved as before', () => {
    const line: Anchor = {
      ...anchorOn(from1, 5, 3, { mark: 'line', tag: { dx: 1, dy: 2 } }),
    }
    line.text = { ...(line.text as NonNullable<Anchor['text']>), offset: 3 }
    const gone = versionFromLines(
      baseLines.map((l) => (l.startsWith('lantern') ? 'nothing similar here' : l)),
      { versionId: 'v2', ...dims },
    )
    const same = reanchor(line, from1, gone)
    expect(same.status).toBe('approximate')
    expect(same.text).toEqual({ quote: 'lantern! glows softly', wordStart: -1, wordEnd: -1 })
    expect(same.text).not.toHaveProperty('offset')
    expect(same.mark).toBe('line')
    expect(same.tag).toEqual({ dx: 1, dy: 2 })
    const longer = versionFromLines(
      [...baseLines, ...fill(30, 'c')].map((l) => (l.startsWith('lantern') ? 'zzz' : l)),
      { versionId: 'v3', ...dims },
    )
    const diff = reanchor(line, from1, longer)
    expect(diff.status).toBe('unresolved')
    expect(diff.text).not.toHaveProperty('offset')
    expect(diff.mark).toBe('line')
    expect(diff.tag).toEqual({ dx: 1, dy: 2 })
  })

  test('mark and tag survive a match, several matches, and the safe fallbacks', () => {
    const marked: Anchor = {
      ...anchorOn(from1, 5, 3, { mark: 'highlight', tag: { dx: 9, dy: 8 } }),
    }
    const check = (r: Anchor) => {
      expect(r.mark).toBe('highlight')
      expect(r.tag).toEqual({ dx: 9, dy: 8 })
    }
    const moved = versionFromLines([...fill(2, 'z'), ...baseLines], { versionId: 'v2', ...dims })
    check(reanchor(marked, from1, moved))
    const doubled = versionFromLines([...baseLines, 'lantern! glows softly'], {
      versionId: 'v3',
      ...dims,
    })
    const several = reanchor(marked, from1, doubled)
    expect(several.status).toBe('approximate')
    check(several)
    check(reanchor(marked, from1, versionFromLines(fill(3, 'q'), { versionId: 'v4', ...dims })))
    // The catch fallbacks: matching throws on the old version.
    const layers = new Map(from1.layers)
    layers.get = () => {
      throw new Error('boom')
    }
    const flaky = { ...from1, layers } as VersionText
    const safe = reanchor(marked, flaky, moved)
    expect(safe.status).toBe('unresolved')
    check(safe)
  })

  test('a highlight of twelve words keeps all twelve after a revision that moves it', () => {
    const twelve = words('amber', 12).join(' ')
    const a = versionFromLines([...fill(5, 'a'), twelve, ...fill(10, 'b')], {
      versionId: 'v1',
      ...dims,
    })
    const anchor = anchorOn(a, 5, 12, { mark: 'highlight' })
    expect(anchor.text?.wordEnd).toBe((anchor.text?.wordStart as number) + 11)
    const b = versionFromLines([...fill(4, 'n'), ...fill(5, 'a'), twelve, ...fill(10, 'b')], {
      versionId: 'v2',
      ...dims,
    })
    const r = reanchor(anchor, a, b)
    const start = (b.layers.get(0) as WordLayer).words.findIndex((w) => w.t === 'amber0')
    expect(r.status).toBe('ok')
    expect(r.text?.quote).toBe(twelve)
    expect(r.text).toEqual({ quote: twelve, wordStart: start, wordEnd: start + 11 })
    expect(r.y).toBeCloseTo(lineCentreY(b.layers.get(0) as WordLayer, 9), 6)
  })

  test('a highlight whose quote was cut at 400 characters comes back approximate', () => {
    const longLines = Array.from({ length: 8 }, (_, k) => words(`w${k}xxxxxxx`, 10).join(' '))
    const text = [...fill(2, 'a'), ...longLines, ...fill(2, 'b')]
    const a = versionFromLines(text, { versionId: 'v1', ...dims })
    const layer = a.layers.get(0) as WordLayer
    const wordStart = (layer.lines[2] as number[])[0] as number
    const wordEnd = (layer.lines[9] as number[]).at(-1) as number
    const all80 = layer.words.slice(wordStart, wordEnd + 1).map((w) => w.t)
    const quote = cutQuote(all80)
    expect(quote.split(' ').length).toBeLessThan(80)
    const anchor: Anchor = {
      ...anchorOn(a, 2, 1),
      text: { quote, wordStart, wordEnd },
      mark: 'highlight',
    }
    const b = versionFromLines(text, { versionId: 'v2', ...dims })
    const r = reanchor(anchor, a, b)
    expect(r.status).toBe('approximate')
    expect(r.text?.quote).toBe(quote)
    expect(r.text?.wordEnd).toBe(wordStart + quote.split(' ').length - 1)
    // Only a highlight is held back: the same stored range on an underline stays ok.
    expect(reanchor({ ...anchor, mark: undefined }, a, b).status).toBe('ok')
    // A normal highlight is still ok.
    const short = anchorOn(a, 2, 10, { mark: 'highlight' })
    expect(reanchor(short, a, b).status).toBe('ok')
  })

  test('an uncut highlight is ok even when layer word indices are not in reading order', () => {
    // Two lines whose words interleave in the layer: line A holds the even indices, line B the odd ones.
    const a = Array.from({ length: 12 }, (_, k) => `alpha${k}`)
    const b = Array.from({ length: 12 }, (_, k) => `bravo${k}`)
    const layerWords: WordLayer['words'] = []
    const lineA: number[] = []
    const lineB: number[] = []
    for (let k = 0; k < 12; k++) {
      lineA.push(layerWords.length)
      layerWords.push({ t: a[k] as string, x: 72 + k * 40, y: 700, w: 38, h: 10 })
      lineB.push(layerWords.length)
      layerWords.push({ t: b[k] as string, x: 72 + k * 40, y: 686, w: 38, h: 10 })
    }
    const version = (versionId: string): VersionText => ({
      versionId,
      documentId: 'doc',
      pageCount: 1,
      pages: [{ width: 595, height: 842 }],
      layers: new Map([[0, { words: layerWords, lines: [lineA, lineB] }]]),
    })
    const anchor: Anchor = {
      documentId: 'doc',
      documentVersionId: 'v1',
      pageIndex: 0,
      x: 72,
      y: 705,
      text: { quote: a.join(' '), wordStart: 0, wordEnd: 22 },
      mark: 'highlight',
      status: 'ok',
    }
    const r = reanchor(anchor, version('v1'), version('v2'))
    expect(r.status).toBe('ok')
    expect(r.text?.quote).toBe(a.join(' '))
    expect(r.text).toMatchObject({ wordStart: 0, wordEnd: 22 })
  })

  test('an eight-word underline re-anchors exactly as before', () => {
    const eight = words('cedar', 8).join(' ')
    const a = versionFromLines([...fill(5, 'a'), `${eight} trailing words`, ...fill(10, 'b')], {
      versionId: 'v1',
      ...dims,
    })
    const anchor = anchorOn(a, 5, 8)
    const b = versionFromLines(
      [...fill(3, 'n'), ...fill(5, 'a'), `${eight} trailing words`, ...fill(10, 'b')],
      { versionId: 'v2', ...dims },
    )
    const r = reanchor(anchor, a, b)
    const start = (b.layers.get(0) as WordLayer).words.findIndex((w) => w.t === 'cedar0')
    expect(r.status).toBe('ok')
    expect(r.text).toEqual({ quote: eight, wordStart: start, wordEnd: start + 7 })
  })
})
