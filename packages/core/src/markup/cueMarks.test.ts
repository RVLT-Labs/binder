import type { Anchor, WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { caretX } from './caret'
import { markInputs, withMark } from './cueMarks'

const layer: WordLayer = {
  words: [
    { t: 'welcome', x: 100, y: 700, w: 70, h: 12 },
    { t: 'there', x: 180, y: 700, w: 50, h: 12 },
    { t: 'friend', x: 240, y: 700, w: 60, h: 12 },
    { t: 'next', x: 100, y: 680, w: 30, h: 12 },
  ],
  lines: [[0, 1, 2], [3]],
}

const range = { quote: 'welcome there', wordStart: 0, wordEnd: 1 }
const at = { documentId: 'd', documentVersionId: 'v', pageIndex: 0, status: 'ok' } as const
const base: Anchor = { ...at, x: 100, y: 700, text: range }

describe('markInputs', () => {
  test("underline and highlight return the range's boxes and no caret", () => {
    for (const mark of ['underline', 'highlight'] as const) {
      const r = markInputs(layer, { mark, text: range })
      expect(r.mark).toBe(mark)
      expect(r.caret).toBeNull()
      expect(r.triggerBoxes).toEqual([{ x: 100, y: 700, w: 130, h: 12 }])
    }
    expect(markInputs(layer, { text: range }).mark).toBe('underline')
  })

  test("line and pointer return only the first word's box as the trigger box, plus the caret", () => {
    for (const mark of ['line', 'pointer'] as const) {
      const r = markInputs(layer, { mark, text: { ...range, offset: 3 } })
      expect(r.mark).toBe(mark)
      expect(r.triggerBoxes).toEqual([{ x: 100, y: 700, w: 70, h: 12 }])
      expect(r.caret?.x).toBeCloseTo(caretX(layer.words[0] as never, 3))
      expect(r.caret?.box).toEqual({ x: 100, y: 700, w: 70, h: 12 })
    }
  })

  test('no layer, or an unbound text, returns no boxes and no caret for every mark', () => {
    for (const mark of ['underline', 'highlight', 'line', 'pointer'] as const) {
      for (const [l, text] of [
        [null, range],
        [undefined, range],
        [layer, undefined],
        [layer, { quote: '', wordStart: -1, wordEnd: -1 }],
      ] as const) {
        const r = markInputs(l, { mark, text })
        expect(r.mark).toBe(mark)
        expect(r.triggerBoxes).toEqual([])
        expect(r.caret).toBeNull()
      }
    }
  })
})

describe('withMark', () => {
  test('the same mark returns an equal anchor; underline removes the key so old shapes stay old', () => {
    const hl: Anchor = { ...base, mark: 'highlight' }
    expect(withMark(hl, 'highlight')).toEqual(hl)
    expect(withMark(base, 'underline')).toEqual(base)
    expect('mark' in withMark(hl, 'underline')).toBe(false)
    expect(hl.mark).toBe('highlight')
  })

  test('to line on a bound anchor sets offset 0 (or opts.offset, or keeps the existing one) and, given the layer, sets x to the caret x', () => {
    const a = withMark(base, 'line')
    expect(a.mark).toBe('line')
    expect(a.text?.offset).toBe(0)
    expect(a.x).toBe(100)
    expect(base.text?.offset).toBeUndefined()

    const b = withMark(base, 'pointer', { layer, offset: 3 })
    expect(b.text?.offset).toBe(3)
    expect(b.x).toBeCloseTo(caretX(layer.words[0] as never, 3))
    expect(b.y).toBe(700)

    const c = withMark({ ...base, mark: 'line', text: { ...range, offset: 2 } }, 'pointer')
    expect(c.text?.offset).toBe(2)

    expect(withMark(base, 'line', { layer, offset: 99 }).text?.offset).toBe(7)
    expect(withMark(base, 'line', { layer, offset: 99 }).x).toBeCloseTo(170)
  })

  test('from line to underline or highlight drops the offset and keeps the range, as the MCP always has', () => {
    const line: Anchor = { ...base, mark: 'line', text: { ...range, offset: 3 } }
    for (const mark of ['underline', 'highlight'] as const) {
      const r = withMark(line, mark)
      expect(r.text).toEqual(range)
      expect(r.text && 'offset' in r.text).toBe(false)
      expect(withMark(line, mark, { layer }).text).toEqual(range)
    }
    expect(line.text).toEqual({ ...range, offset: 3 })
  })

  test('with oneWord, from line to underline or highlight covers only the word the bar sits in', () => {
    const line: Anchor = { ...base, mark: 'line', text: { ...range, offset: 3 } }
    for (const mark of ['underline', 'highlight'] as const) {
      for (const opts of [{ oneWord: true }, { layer, oneWord: true }]) {
        const r = withMark(line, mark, opts)
        expect(r.text).toEqual({ quote: 'welcome', wordStart: 0, wordEnd: 0 })
        expect(r.text && 'offset' in r.text).toBe(false)
        // x stays put, so a moved bubble (an offset from x) does not shift
        expect(r.x).toBe(line.x)
        expect(r.y).toBe(line.y)
      }
    }
    expect(line.text).toEqual({ ...range, offset: 3 })
  })

  test('the word comes from the layer when it has one, else from the quote', () => {
    const line: Anchor = {
      ...base,
      mark: 'pointer',
      text: { quote: 'stale words', wordStart: 1, wordEnd: 2, offset: 1 },
    }
    const one = { oneWord: true }
    expect(withMark(line, 'highlight', { layer, ...one }).text?.quote).toBe('there')
    expect(withMark(line, 'highlight', one).text?.quote).toBe('stale')
    expect(withMark(line, 'highlight', { layer, ...one }).text).toMatchObject({
      wordStart: 1,
      wordEnd: 1,
    })
  })

  test('a line that already covers one word, or is unbound, keeps its text as it is', () => {
    const one: Anchor = {
      ...base,
      mark: 'line',
      text: { quote: 'welcome', wordStart: 0, wordEnd: 0, offset: 2 },
    }
    expect(withMark(one, 'highlight', { oneWord: true }).text).toEqual({
      quote: 'welcome',
      wordStart: 0,
      wordEnd: 0,
    })
    const unbound: Anchor = {
      ...base,
      mark: 'line',
      text: { quote: '', wordStart: -1, wordEnd: -1 },
    }
    expect(withMark(unbound, 'highlight', { oneWord: true }).text).toEqual({
      quote: '',
      wordStart: -1,
      wordEnd: -1,
    })
  })

  test('between underline and highlight the range is untouched, even with oneWord', () => {
    const hl = withMark(base, 'highlight', { oneWord: true })
    expect(hl.text).toEqual(range)
    expect(withMark(hl, 'underline', { oneWord: true }).text).toEqual(range)
  })

  test('to line on an unbound anchor adds no offset and leaves x and y', () => {
    const noText: Anchor = { ...at, x: 12, y: 34 }
    const unbound: Anchor = {
      ...at,
      x: 12,
      y: 34,
      text: { quote: '', wordStart: -1, wordEnd: -1 },
    }
    for (const a of [noText, unbound]) {
      const r = withMark(a, 'line', { layer, offset: 3 })
      expect(r.mark).toBe('line')
      expect(r.x).toBe(12)
      expect(r.y).toBe(34)
      expect(r.text && 'offset' in r.text).toBeFalsy()
    }
  })
})
