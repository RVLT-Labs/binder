import { CUE_SIZE_SCALE } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import {
  type CueTagInput,
  type CueTagLayout,
  layoutCueTags,
  TAG_EDGE,
  TAG_FONT_SIZE,
  TAG_GAP,
  TAG_HEIGHT,
  TAG_PAD,
  TAG_RADIUS,
  TAG_TEXT_GAP,
  tagWidth,
} from './cueTags'
import { helveticaBoldWidth, helveticaWidth } from './helvetica'

const WIDTH = 600
const WIDE = { minX: 150, maxX: 450 }
const BOUNDS = { minY: 0, maxY: 800 }
const S = CUE_SIZE_SCALE.large

const cue = (id: string, over: Partial<CueTagInput> = {}): CueTagInput => ({
  id,
  y: 500,
  side: 'left',
  type: 'go',
  lead: 'LX',
  typeWord: '',
  number: '10',
  triggerBoxes: [],
  anchorX: 200,
  sortKey: { department: 0, major: 10, minor: 0 },
  ...over,
})
const layout = (
  cues: CueTagInput[],
  extent: { minX: number; maxX: number } | null = WIDE,
  bounds = BOUNDS,
) => layoutCueTags({ pageWidth: WIDTH, bounds, textExtent: extent, cues })
const one = (c: CueTagInput, extent: { minX: number; maxX: number } | null = WIDE) =>
  layout([c], extent)[0] as CueTagLayout

const word = { x: 200, y: 495, w: 40, h: 10 }

describe('cue size', () => {
  test('normal is exactly today: an absent size and normal lay out the same, 14 pt pill and 9 pt type', () => {
    const page = [
      cue('a', { triggerBoxes: [word] }),
      cue('b', { side: 'right', mark: 'highlight', triggerBoxes: [word], note: 'Fade slow' }),
      cue('c', { y: 300, tag: { dx: 30, dy: 40 } }),
    ]
    const absent = layout(page)
    const normal = layout(page.map((c) => ({ ...c, size: 'normal' as const })))
    expect(normal).toEqual(absent)
    for (const t of absent) {
      expect(t.size).toBe('normal')
      expect(t.tag.h).toBe(TAG_HEIGHT)
      expect(t.fontSize).toBe(TAG_FONT_SIZE)
      expect(t.radius).toBe(TAG_RADIUS)
    }
  })

  test('normal keeps the fixed pre-change numbers: a 14 pt pill at x 4 centred on its line, 9 pt type, a leader from under its curve', () => {
    const t = one(cue('a', { triggerBoxes: [word] }))
    const w = helveticaWidth('LX', 9) + helveticaBoldWidth('10', 9) + 15
    expect(t.tag).toEqual({ x: 4, y: 493, w: expect.closeTo(w, 9), h: 14 })
    expect([t.fontSize, t.radius, t.centreY, t.leadX]).toEqual([9, 7, 500, 10])
    expect(t.numberX).toBeCloseTo(10 + helveticaWidth('LX', 9) + 3)
    expect(t.leader).toEqual([
      { x: expect.closeTo(4 + w - 7, 9), y: 494 },
      { x: 200, y: 494 },
    ])
    const [a, b] = layout([cue('a'), cue('b')])
    expect([(a as CueTagLayout).centreY, (b as CueTagLayout).centreY]).toEqual([508, 492])
  })

  test('large scales the pill, its padding, its gap and both texts by the large scale', () => {
    const t = one(cue('a', { size: 'large', lead: 'SB LX', number: '14.5', type: 'standby' }))
    expect(S).toBeGreaterThanOrEqual(1.25)
    expect(t.size).toBe('large')
    expect(t.tag.h).toBeCloseTo(TAG_HEIGHT * S)
    expect(t.radius).toBeCloseTo((TAG_HEIGHT * S) / 2)
    expect(t.fontSize).toBeCloseTo(TAG_FONT_SIZE * S)
    const expected =
      TAG_PAD * S +
      helveticaWidth('SB LX', TAG_FONT_SIZE * S) +
      TAG_TEXT_GAP * S +
      helveticaBoldWidth('14.5', TAG_FONT_SIZE * S) +
      TAG_PAD * S
    expect(t.tag.w).toBeCloseTo(expected)
    expect(tagWidth('SB LX', '14.5', S)).toBeCloseTo(expected)
    expect(t.tag.w).toBeCloseTo(tagWidth('SB LX', '14.5') * S)
    expect(t.leadX).toBeCloseTo(t.tag.x + TAG_PAD * S)
    expect(t.numberX + helveticaBoldWidth('14.5', TAG_FONT_SIZE * S) + TAG_PAD * S).toBeCloseTo(
      t.tag.x + t.tag.w,
    )
    // Still flush with its page edge and level with its line.
    expect(t.tag.x).toBe(TAG_EDGE)
    expect(t.centreY).toBe(500)
  })

  test('a large tag on the right is flush with the right page edge', () => {
    const t = one(cue('a', { side: 'right', size: 'large', number: '1234.56' }))
    expect(t.tag.x + t.tag.w).toBeCloseTo(WIDTH - TAG_EDGE)
  })

  test('crowded large tags stack a large height plus the gap apart; mixed sizes never overlap', () => {
    const [a, b] = layout([cue('a', { size: 'large' }), cue('b', { size: 'large' })])
    expect((a as CueTagLayout).centreY - (b as CueTagLayout).centreY).toBeCloseTo(
      TAG_HEIGHT * S + TAG_GAP,
    )
    const mixed = layout([
      cue('n1', { y: 500 }),
      cue('L1', { y: 500, size: 'large', sortKey: { department: 1, major: 1, minor: 0 } }),
      cue('n2', { y: 495, sortKey: { department: 2, major: 1, minor: 0 } }),
      cue('L2', { y: 490, size: 'large', sortKey: { department: 3, major: 1, minor: 0 } }),
      cue('n3', { y: 486 }),
    ])
    const down = [...mixed].sort((p, q) => q.centreY - p.centreY)
    for (let i = 1; i < down.length; i++) {
      const upper = down[i - 1] as CueTagLayout
      const lower = down[i] as CueTagLayout
      expect(upper.tag.y - (lower.tag.y + lower.tag.h)).toBeGreaterThanOrEqual(TAG_GAP - 1e-9)
    }
  })

  test('a large tag with a note keeps the note clear of the tag below', () => {
    const [a, b] = layout([cue('a', { size: 'large', note: 'Slow fade' }), cue('b', { y: 499 })])
    const upper = a as CueTagLayout
    const lower = b as CueTagLayout
    if (!upper.note) throw new Error('no note')
    expect(upper.note.box.y).toBeCloseTo(upper.tag.y - upper.note.box.h)
    expect((upper.note?.box.y ?? 0) - (lower.tag.y + lower.tag.h)).toBeGreaterThanOrEqual(
      TAG_GAP - 1e-9,
    )
  })

  test('large tags crowded at the top and the bottom of the page stay inside the bounds', () => {
    const bounds = { minY: 40, maxY: 800 }
    const top = layout(
      [cue('a', { y: 799, size: 'large' }), cue('b', { y: 798, size: 'large' })],
      WIDE,
      bounds,
    )
    const bottom = layout(
      [cue('c', { y: 41, size: 'large' }), cue('d', { y: 40, size: 'large', note: 'Last' })],
      WIDE,
      bounds,
    )
    for (const t of [...top, ...bottom]) {
      const low = t.note ? t.note.box.y : t.tag.y
      expect(low).toBeGreaterThanOrEqual(bounds.minY - 1e-9)
      expect(t.tag.y + t.tag.h).toBeLessThanOrEqual(bounds.maxY + 1e-9)
    }
    expect((top[0] as CueTagLayout).tag.y + (top[0] as CueTagLayout).tag.h).toBeCloseTo(800)
  })

  test('a moved large bubble is held on the page by its own size', () => {
    const t = one(cue('a', { size: 'large', anchorX: 590, y: 795, tag: { dx: 50, dy: 50 } }))
    expect(t.moved).toBe(true)
    expect(t.tag.x + t.tag.w).toBeCloseTo(WIDTH)
    expect(t.tag.y + t.tag.h).toBeCloseTo(BOUNDS.maxY)
    expect(t.tag.h).toBeCloseTo(TAG_HEIGHT * S)
  })

  test('a large tag in a narrow margin sheds its code first so the number always shows', () => {
    // 60 pt of room: a normal `SND 12.50` (about 57 pt) fits, a large one (about 74 pt) does not.
    const narrow = { minX: 68, maxX: 532 }
    expect(tagWidth('SND', '12.50')).toBeLessThanOrEqual(60)
    expect(tagWidth('SND', '12.50', S)).toBeGreaterThan(60)
    const normal = one(cue('a', { lead: 'SND', number: '12.50' }), narrow)
    const large = one(cue('a', { lead: 'SND', number: '12.50', size: 'large' }), narrow)
    expect(normal.lead).toBe('SND')
    expect(large.lead).toBe('')
    expect(large.number).toBe('12.50')
    expect(large.tag.w).toBeCloseTo(tagWidth('', '12.50', S))
  })

  test('marks are not resized: the same trigger draws the same underline, fill and bar at either size', () => {
    for (const mark of ['underline', 'highlight', 'line', 'pointer'] as const) {
      const caret = mark === 'line' || mark === 'pointer' ? { x: 210, box: word } : undefined
      const base = cue('a', { mark, triggerBoxes: [word], caret })
      const n = one(base)
      const l = one({ ...base, size: 'large' })
      expect(l.underlines).toEqual(n.underlines)
      expect(l.fills).toEqual(n.fills)
      expect(l.bar).toEqual(n.bar)
      // The leader still ends at the same point on the mark, and starts under the larger pill's curve.
      expect(l.leader?.at(-1)).toEqual(n.leader?.at(-1))
      expect(l.leader?.[0]?.x).toBeCloseTo(l.tag.x + l.tag.w - l.radius)
    }
  })

  test('the straight-leader tolerance is half the pill it leaves from', () => {
    // The underline is 10 pt below the tag's centre: past a normal pill's reach, inside a large one's.
    const base = cue('a', { y: 504, triggerBoxes: [word] })
    expect(one(base).leader).toHaveLength(4)
    expect(one({ ...base, size: 'large' }).leader).toHaveLength(2)
  })
})
