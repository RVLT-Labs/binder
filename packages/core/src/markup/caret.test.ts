import type { WordLayer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { caretAt, caretX, clampOffset, snapToCaret } from './caret'
import { helveticaWidth } from './helvetica'

const layer: WordLayer = {
  words: [
    { t: 'welcome', x: 100, y: 700, w: 70, h: 12 },
    { t: 'there', x: 180, y: 700, w: 50, h: 12 },
    { t: 'friend', x: 240, y: 700, w: 60, h: 12 },
    { t: 'next', x: 100, y: 680, w: 30, h: 12 },
  ],
  lines: [[0, 1, 2], [3]],
}

describe('caretX', () => {
  test("offset 0 is the word's left edge and the full length is its right edge", () => {
    const w = { x: 100, w: 70, t: 'welcome' }
    expect(caretX(w, 0)).toBe(100)
    expect(caretX(w, 7)).toBeCloseTo(170)
  })

  test('a middle offset is proportional to Helvetica widths', () => {
    const w = { x: 100, w: 70, t: 'welcome' }
    expect(caretX(w, 3)).toBeCloseTo(
      100 + (70 * helveticaWidth('wel', 10)) / helveticaWidth('welcome', 10),
    )
  })

  test('a zero-width word, a surrogate-pair emoji and a combining accent give a finite x inside [x, x + w]', () => {
    for (const w of [
      { x: 50, w: 0, t: 'abc' },
      { x: 50, w: 20, t: '😀😀' },
      { x: 50, w: 20, t: 'éa' },
    ]) {
      const n = Array.from(w.t).length
      for (let o = 0; o <= n; o++) {
        const x = caretX(w, o)
        expect(Number.isFinite(x)).toBe(true)
        expect(x).toBeGreaterThanOrEqual(w.x)
        expect(x).toBeLessThanOrEqual(w.x + w.w + 1e-9)
      }
    }
  })
})

describe('clampOffset', () => {
  test('clamps negatives to 0 and large values to the length', () => {
    expect(clampOffset('abc', -4)).toBe(0)
    expect(clampOffset('abc', 99)).toBe(3)
    expect(clampOffset('😀a', 99)).toBe(2)
    expect(clampOffset('abc', 1.7)).toBe(1)
  })
})

describe('caretAt', () => {
  test("unbound text gives null; an offset past the word's length clamps; the box is the word's box", () => {
    expect(caretAt(layer, { wordStart: -1 })).toBeNull()
    const c = caretAt(layer, { wordStart: 1, offset: 99 })
    expect(c?.x).toBeCloseTo(230)
    expect(c?.box).toEqual({ x: 180, y: 700, w: 50, h: 12 })
    expect(caretAt(layer, { wordStart: 1 })?.x).toBe(180)
    expect(caretAt(layer, { wordStart: 40 })).toBeNull()
  })
})

describe('snapToCaret', () => {
  test('finds boundaries inside, between, before and after words, and null when far', () => {
    const inside = caretX(layer.words[0] as never, 3)
    expect(snapToCaret(layer, { x: inside + 0.2, y: 706 })?.text).toMatchObject({
      wordStart: 0,
      offset: 3,
    })
    // gap between 'welcome' (ends 170) and 'there' (starts 180)
    expect(snapToCaret(layer, { x: 172, y: 706 })?.text).toMatchObject({ wordStart: 0, offset: 7 })
    expect(snapToCaret(layer, { x: 178, y: 706 })?.text).toMatchObject({ wordStart: 1, offset: 0 })
    expect(snapToCaret(layer, { x: 10, y: 706 })?.text).toMatchObject({ wordStart: 0, offset: 0 })
    expect(snapToCaret(layer, { x: 900, y: 706 })?.text).toMatchObject({ wordStart: 2, offset: 6 })
    expect(snapToCaret(layer, { x: 110, y: 500 })).toBeNull()
  })

  test('the text runs from the chosen word to the line end with y the line centre and x the caret x', () => {
    const r = snapToCaret(layer, { x: 181, y: 708 })
    expect(r).not.toBeNull()
    expect(r?.y).toBe(706)
    expect(r?.x).toBe(180)
    expect(r?.text).toEqual({ quote: 'there friend', wordStart: 1, wordEnd: 2, offset: 0 })
  })

  test('caps the text at eight words', () => {
    const words = Array.from({ length: 12 }, (_, i) => ({
      t: 'ab',
      x: i * 20,
      y: 10,
      w: 15,
      h: 10,
    }))
    const long: WordLayer = { words, lines: [words.map((_, i) => i)] }
    const r = snapToCaret(long, { x: 1, y: 15 })
    expect(r?.text.wordStart).toBe(0)
    expect(r?.text.wordEnd).toBe(7)
  })
})
