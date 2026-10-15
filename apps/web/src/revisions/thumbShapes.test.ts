import type { Anchor, WordLayer } from '@binder/shared'
import { expect, test } from 'vitest'
import { THUMB_WIDTH, thumbShapes } from './thumbShapes'

// A 320 x 400 page, so a 160 px thumbnail is at scale 0.5 and 200 px tall.
const page = { width: 320, height: 400 }
const layer: WordLayer = {
  words: [
    { t: 'Hold', x: 40, y: 300, w: 40, h: 10 },
    { t: 'the', x: 90, y: 300, w: 20, h: 10 },
    { t: 'lights', x: 120, y: 300, w: 50, h: 10 },
    { t: 'next', x: 40, y: 200, w: 30, h: 10 },
  ],
  lines: [[0, 1, 2], [3]],
}
const anchor = (over: Partial<Anchor> = {}): Anchor => ({
  documentId: 'd',
  documentVersionId: 'v',
  pageIndex: 0,
  x: 40,
  y: 305,
  status: 'ok',
  ...over,
})

test('a bound quote is drawn as one box per line, scaled onto the 160 px thumbnail', () => {
  const out = thumbShapes({
    anchor: anchor({ text: { quote: 'Hold the lights next', wordStart: 0, wordEnd: 3 } }),
    layer,
    page,
  })
  expect(THUMB_WIDTH).toBe(160)
  expect(out.width).toBe(160)
  expect(out.height).toBe(200)
  expect(out.marker).toBeNull()
  // Line one spans x 40..170 and y 300..310 (y up); on the thumbnail the top is (400 - 310) * 0.5.
  expect(out.boxes).toEqual([
    { left: 20, top: 45, width: 65, height: 5 },
    { left: 20, top: 95, width: 15, height: 5 },
  ])
})

test('an unbound quote is a marker at the anchor point, with no boxes', () => {
  const out = thumbShapes({
    anchor: anchor({ x: 100, y: 100, text: { quote: 'gone', wordStart: -1, wordEnd: -1 } }),
    layer,
    page,
  })
  expect(out.boxes).toEqual([])
  expect(out.marker).toEqual({ left: 50, top: 150 })
})

test('an anchor with no text, or text whose layer is not loaded, is a marker', () => {
  expect(thumbShapes({ anchor: anchor(), layer, page }).marker).toEqual({ left: 20, top: 47.5 })
  const bound = anchor({ text: { quote: 'Hold', wordStart: 0, wordEnd: 0 } })
  const out = thumbShapes({ anchor: bound, layer: null, page })
  expect(out.boxes).toEqual([])
  expect(out.marker).not.toBeNull()
})
