import { describe, expect, test } from 'vitest'
import {
  type CueTagInput,
  HIGHLIGHT_PAD,
  layoutCueTags,
  TAG_BAR,
  TAG_DIVIDER,
  TAG_EDGE,
  TAG_FONT_SIZE,
  TAG_GAP,
  TAG_HEIGHT,
  TAG_PAD,
  tagWidth,
} from './cueTags'
import { helveticaWidth } from './helvetica'

const WIDTH = 600

const cue = (id: string, over: Partial<CueTagInput> = {}): CueTagInput => ({
  id,
  y: 500,
  side: 'left',
  lead: 'LX',
  number: '10',
  dash: false,
  triggerBoxes: [],
  anchorX: 200,
  sortKey: { department: 0, major: 10, minor: 0 },
  ...over,
})

const layout = (cues: CueTagInput[]) => layoutCueTags({ pageWidth: WIDTH, cues })
const one = (c: CueTagInput) => {
  const [t] = layout([c])
  if (!t) throw new Error('no tag')
  return t
}

describe('tag size', () => {
  test('is 14 high and as wide as its parts, with text widths from Helvetica at 9 pt', () => {
    const w = tagWidth('LX', '10')
    const expected =
      TAG_BAR +
      TAG_PAD +
      helveticaWidth('LX', TAG_FONT_SIZE) +
      TAG_PAD +
      TAG_DIVIDER +
      TAG_PAD +
      helveticaWidth('10', TAG_FONT_SIZE) +
      TAG_PAD
    expect(w).toBeCloseTo(expected)
    expect(TAG_HEIGHT).toBe(14)
    expect(TAG_FONT_SIZE).toBe(9)
    const t = one(cue('a', { lead: 'SB LX', number: '14.5' }))
    expect(t.tag.w).toBeCloseTo(tagWidth('SB LX', '14.5'))
    expect(t.tag.w).toBeGreaterThan(w)
    expect(t.tag.h).toBe(14)
  })

  test('is vertically centred on the cue y', () => {
    const t = one(cue('a', { y: 400 }))
    expect(t.tag.y).toBe(393)
    expect(t.centreY).toBe(400)
  })
})

describe('placement in the margin', () => {
  test('a left tag starts 4 points inside the left edge, the bar on its outer (left) edge', () => {
    const t = one(cue('a'))
    expect(t.tag.x).toBe(4)
    expect(TAG_EDGE).toBe(4)
    expect(t.bar).toEqual({ x: 4, y: t.tag.y, w: 4, h: 14 })
    expect(t.leadX).toBeCloseTo(4 + TAG_BAR + TAG_PAD)
    expect(t.dividerX).toBeCloseTo(t.leadX + helveticaWidth('LX', 9) + TAG_PAD)
    expect(t.numberX).toBeCloseTo(t.dividerX + TAG_DIVIDER + TAG_PAD)
    expect(t.numberX + helveticaWidth('10', 9) + TAG_PAD).toBeCloseTo(t.tag.x + t.tag.w)
  })

  test('a right tag ends 4 points inside the right edge, the bar on its outer (right) edge', () => {
    const t = one(cue('a', { side: 'right' }))
    expect(t.tag.x + t.tag.w).toBeCloseTo(WIDTH - 4)
    expect(t.bar.x + t.bar.w).toBeCloseTo(WIDTH - 4)
    expect(t.bar.w).toBe(4)
    // The text still reads lead then number, left to right, inside the bar.
    expect(t.leadX).toBeCloseTo(t.tag.x + TAG_PAD)
    expect(t.dividerX).toBeGreaterThan(t.leadX)
    expect(t.numberX).toBeGreaterThan(t.dividerX)
    expect(t.numberX + helveticaWidth('10', 9) + TAG_PAD).toBeCloseTo(t.bar.x)
  })

  test('three grip dots sit in the middle of the bar', () => {
    const t = one(cue('a', { y: 300 }))
    expect(t.grips).toHaveLength(3)
    for (const g of t.grips) expect(g.x).toBeCloseTo(t.bar.x + t.bar.w / 2)
    expect(t.grips.map((g) => g.y)).toEqual([...t.grips.map((g) => g.y)].sort((a, b) => b - a))
    expect(t.grips[1]?.y).toBeCloseTo(300)
  })

  test('the standby dash is carried through', () => {
    expect(one(cue('a', { dash: true })).dash).toBe(true)
    expect(one(cue('a')).dash).toBe(false)
  })
})

describe('crowding', () => {
  const sort = (department: number, major: number, minor = 0) => ({ department, major, minor })

  test('tags whose vertical extents overlap sit side by side, inward, 2 points apart', () => {
    const [a, b] = layout([
      cue('a', { sortKey: sort(0, 10) }),
      cue('b', { y: 505, lead: 'SND', number: '2', sortKey: sort(1, 2) }),
    ])
    if (!a || !b) throw new Error('tags')
    expect(a.tag.x).toBe(4)
    expect(b.tag.x).toBeCloseTo(a.tag.x + a.tag.w + TAG_GAP)
    expect(TAG_GAP).toBe(2)
  })

  test('on the right they move inward (leftward) from the right edge', () => {
    const [a, b] = layout([
      cue('a', { side: 'right', sortKey: sort(0, 10) }),
      cue('b', { side: 'right', y: 505, number: '11', sortKey: sort(0, 11) }),
    ])
    if (!a || !b) throw new Error('tags')
    expect(a.tag.x + a.tag.w).toBeCloseTo(WIDTH - 4)
    expect(b.tag.x + b.tag.w).toBeCloseTo(a.tag.x - TAG_GAP)
  })

  test('the order is department sort order, then cue number, then id, whatever the input order', () => {
    const tags = layout([
      cue('z', { sortKey: sort(1, 1) }),
      cue('m', { sortKey: sort(0, 12) }),
      cue('b', { sortKey: sort(0, 11, 5) }),
      cue('a', { sortKey: sort(0, 11, 5) }),
    ])
    const byX = [...tags].sort((p, q) => p.tag.x - q.tag.x).map((t) => t.id)
    expect(byX).toEqual(['a', 'b', 'm', 'z'])
    // Returned in the input order.
    expect(tags.map((t) => t.id)).toEqual(['z', 'm', 'b', 'a'])
  })

  test('tags a full height apart, or on opposite sides, do not crowd', () => {
    const tags = layout([cue('a'), cue('b', { y: 500 - TAG_HEIGHT }), cue('c', { side: 'right' })])
    expect(tags.map((t) => t.tag.x)).toEqual([4, 4, tags[2]?.tag.x])
    expect(tags[2]?.tag.x).toBeGreaterThan(300)
  })

  test('a later tag steps past every overlapping tag, and a leader starts at its own tag', () => {
    const boxes = [{ x: 300, y: 495, w: 40, h: 10 }]
    const [a, b] = layout([
      cue('a', { triggerBoxes: boxes, sortKey: sort(0, 1) }),
      cue('b', { triggerBoxes: boxes, y: 502, sortKey: sort(0, 2) }),
    ])
    if (!a || !b) throw new Error('tags')
    expect(a.leader?.x1).toBeCloseTo(a.tag.x + a.tag.w)
    expect(b.leader?.x1).toBeCloseTo(b.tag.x + b.tag.w)
    expect(b.leader?.x1).toBeGreaterThan(a.leader?.x1 ?? 0)
  })
})

describe('trigger highlight and leader', () => {
  const words = [
    { x: 300, y: 495, w: 40, h: 10 },
    { x: 100, y: 475, w: 60, h: 10 },
  ]

  test('each word box is padded 1.5 points', () => {
    const t = one(cue('a', { triggerBoxes: words }))
    expect(HIGHLIGHT_PAD).toBe(1.5)
    expect(t.triggerBoxes).toEqual([
      { x: 298.5, y: 493.5, w: 43, h: 13 },
      { x: 98.5, y: 473.5, w: 63, h: 13 },
    ])
    expect(t.tick).toBeNull()
  })

  test('a left leader runs from the tag right edge to the highlight left edge at the tag bottom', () => {
    const t = one(cue('a', { triggerBoxes: words }))
    expect(t.leader).toEqual({ x1: expect.closeTo(t.tag.x + t.tag.w), x2: 298.5, y: 493 })
  })

  test('a right leader runs from the highlight right edge to the tag left edge', () => {
    const t = one(cue('a', { side: 'right', triggerBoxes: words }))
    expect(t.leader).toEqual({ x1: 341.5, x2: expect.closeTo(t.tag.x), y: 493 })
  })

  test('the leader joins the first highlight box, not a later line', () => {
    const t = one(cue('a', { triggerBoxes: [words[1] as (typeof words)[number], ...words] }))
    expect(t.leader?.x2).toBe(98.5)
  })

  test('no leader when the tag and the highlight already touch or overlap', () => {
    const near = { x: 20, y: 495, w: 40, h: 10 }
    expect(one(cue('a', { triggerBoxes: [near] })).leader).toBeNull()
    const nearRight = { x: WIDTH - 60, y: 495, w: 40, h: 10 }
    expect(one(cue('a', { side: 'right', triggerBoxes: [nearRight] })).leader).toBeNull()
    // A highlight on the far side of the tag from the page edge is no leader either.
    expect(one(cue('a', { triggerBoxes: [{ x: 6, y: 495, w: 10, h: 10 }] })).leader).toBeNull()
  })

  test('an unbound cue has an 8 point tick at its anchor and a leader to it', () => {
    const t = one(cue('a', { anchorX: 250 }))
    expect(t.triggerBoxes).toEqual([])
    expect(t.tick).toEqual({ x: 250, y1: 496, y2: 504 })
    expect(t.leader).toEqual({ x1: expect.closeTo(t.tag.x + t.tag.w), x2: 250, y: 493 })
    const r = one(cue('a', { side: 'right', anchorX: 250 }))
    expect(r.leader).toEqual({ x1: 250, x2: expect.closeTo(r.tag.x), y: 493 })
  })

  test('a bound cue draws no tick', () => {
    expect(one(cue('a', { triggerBoxes: words })).tick).toBeNull()
  })
})
