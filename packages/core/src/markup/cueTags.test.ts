import { describe, expect, test } from 'vitest'
import {
  type CueTagInput,
  DEFAULT_MARGIN,
  LEADER_GUTTER,
  layoutCueTags,
  TAG_EDGE,
  TAG_FONT_SIZE,
  TAG_GAP,
  TAG_HEIGHT,
  TAG_PAD,
  TAG_RADIUS,
  TAG_TEXT_GAP,
  tagWidth,
  textExtent,
  UNDERLINE_DROP,
  UNDERLINE_WIDTH,
} from './cueTags'
import { helveticaBoldWidth, helveticaWidth } from './helvetica'

const WIDTH = 600

const cue = (id: string, over: Partial<CueTagInput> = {}): CueTagInput => ({
  id,
  y: 500,
  side: 'left',
  type: 'go',
  lead: 'LX',
  code: 'LX',
  number: '10',
  triggerBoxes: [],
  anchorX: 200,
  sortKey: { department: 0, major: 10, minor: 0 },
  ...over,
})

/** A wide margin on both sides, so only the tests about the margin are about it. */
const WIDE = { minX: 150, maxX: 450 }
const layout = (cues: CueTagInput[], extent: { minX: number; maxX: number } | null = WIDE) =>
  layoutCueTags({ pageWidth: WIDTH, textExtent: extent, cues })
const one = (c: CueTagInput, extent: { minX: number; maxX: number } | null = WIDE) => {
  const [t] = layout([c], extent)
  if (!t) throw new Error('no tag')
  return t
}

describe('the pill', () => {
  test('is 14 high with a radius of half its height, sized from Helvetica and Helvetica-Bold at 9 pt', () => {
    expect(TAG_HEIGHT).toBe(14)
    expect(TAG_RADIUS).toBe(TAG_HEIGHT / 2)
    expect(TAG_FONT_SIZE).toBe(9)
    expect(TAG_TEXT_GAP).toBe(3)
    const expected =
      TAG_PAD + helveticaWidth('LX', 9) + TAG_TEXT_GAP + helveticaBoldWidth('10', 9) + TAG_PAD
    expect(tagWidth('LX', '10')).toBeCloseTo(expected)
    const t = one(cue('a', { lead: 'SB LX', number: '14.5', type: 'standby' }))
    expect(t.tag.w).toBeCloseTo(tagWidth('SB LX', '14.5'))
    expect(t.tag.w).toBeGreaterThan(tagWidth('LX', '10'))
    expect(t.tag.h).toBe(14)
  })

  test('is vertically centred on the cue y', () => {
    const t = one(cue('a', { y: 400 }))
    expect(t.tag.y).toBe(393)
    expect(t.centreY).toBe(400)
  })

  test('the code then a 3 point gap then the number, left to right, on either side', () => {
    for (const side of ['left', 'right'] as const) {
      const t = one(cue('a', { side }))
      expect(t.leadX).toBeCloseTo(t.tag.x + TAG_PAD)
      expect(t.numberX).toBeCloseTo(t.leadX + helveticaWidth('LX', 9) + 3)
      expect(t.numberX + helveticaBoldWidth('10', 9) + TAG_PAD).toBeCloseTo(t.tag.x + t.tag.w)
    }
  })

  test('outline: 1 pt solid for go, 1 pt dashed for standby, 1.5 pt solid for warn', () => {
    expect(one(cue('a', { type: 'go' }))).toMatchObject({ dash: false, outlineWidth: 1 })
    expect(one(cue('a', { type: 'standby' }))).toMatchObject({ dash: true, outlineWidth: 1 })
    expect(one(cue('a', { type: 'warn' }))).toMatchObject({ dash: false, outlineWidth: 1.5 })
  })
})

describe('placement in the margin', () => {
  test('a left tag starts 4 points inside the left edge', () => {
    expect(one(cue('a')).tag.x).toBe(4)
    expect(TAG_EDGE).toBe(4)
  })

  test('a right tag ends 4 points inside the right edge', () => {
    const t = one(cue('a', { side: 'right' }))
    expect(t.tag.x + t.tag.w).toBeCloseTo(WIDTH - 4)
  })
})

describe('crowding: tags stack vertically in the margin', () => {
  const sort = (department: number, major: number, minor = 0) => ({ department, major, minor })

  test('tags whose vertical extents overlap stack downward, TAG_HEIGHT + 2 apart, flush at the same x', () => {
    const [a, b, c] = layout([
      cue('a', { sortKey: sort(0, 10) }),
      cue('b', { y: 505, lead: 'SND', code: 'SND', number: '2', sortKey: sort(1, 2) }),
      cue('c', { y: 498, number: '12', sortKey: sort(1, 3) }),
    ])
    if (!a || !b || !c) throw new Error('tags')
    expect([a.tag.x, b.tag.x, c.tag.x]).toEqual([4, 4, 4])
    expect(TAG_GAP).toBe(2)
    expect(a.centreY).toBe(500)
    expect(b.centreY).toBe(500 - (TAG_HEIGHT + TAG_GAP))
    expect(c.centreY).toBe(500 - 2 * (TAG_HEIGHT + TAG_GAP))
    expect(a.tag.y - (b.tag.y + b.tag.h)).toBeCloseTo(TAG_GAP)
  })

  test('on the right they stack in the right margin, ending 4 points inside the edge', () => {
    const [a, b] = layout([
      cue('a', { side: 'right', sortKey: sort(0, 10) }),
      cue('b', { side: 'right', y: 505, number: '11', sortKey: sort(0, 11) }),
    ])
    if (!a || !b) throw new Error('tags')
    expect(a.tag.x + a.tag.w).toBeCloseTo(WIDTH - 4)
    expect(b.tag.x + b.tag.w).toBeCloseTo(WIDTH - 4)
    expect(b.centreY).toBe(500 - (TAG_HEIGHT + TAG_GAP))
  })

  test('the order is department sort order, then cue number, then id, whatever the input order', () => {
    const tags = layout([
      cue('z', { sortKey: sort(1, 1) }),
      cue('m', { sortKey: sort(0, 12) }),
      cue('b', { sortKey: sort(0, 11, 5) }),
      cue('a', { sortKey: sort(0, 11, 5) }),
    ])
    const topToBottom = [...tags].sort((p, q) => q.centreY - p.centreY).map((t) => t.id)
    expect(topToBottom).toEqual(['a', 'b', 'm', 'z'])
    expect(tags.map((t) => t.id)).toEqual(['z', 'm', 'b', 'a'])
  })

  test('tags a full height apart, or on opposite sides, do not stack', () => {
    const tags = layout([cue('a'), cue('b', { y: 500 - TAG_HEIGHT }), cue('c', { side: 'right' })])
    expect(tags.map((t) => t.centreY)).toEqual([500, 500 - TAG_HEIGHT, 500])
  })

  test('a stacked tag keeps its own connector, which leaves its own tag and jogs to its own underline', () => {
    const boxes = [{ x: 300, y: 495, w: 40, h: 10 }]
    const [a, b] = layout([
      cue('a', { triggerBoxes: boxes, sortKey: sort(0, 1) }),
      cue('b', { triggerBoxes: boxes, y: 502, sortKey: sort(0, 2) }),
    ])
    if (!a || !b) throw new Error('tags')
    // The tag on its own line runs straight out to its underline.
    expect(a.leader?.map((p) => p.y)).toEqual([494, 494])
    // The pushed one leaves its tag at the tag's centre and meets the underline in the gutter.
    expect(b.leader?.[0]).toEqual({ x: expect.closeTo(b.tag.x + b.tag.w), y: b.centreY })
    expect(b.leader?.at(-1)).toEqual({ x: 300, y: 494 })
    expect(b.centreY).toBeLessThan(a.centreY)
    // The underline stays under the cue's own words.
    expect(b.underlines[0]?.y).toBe(494)
  })
})

describe('the margin: a tag never enters the text block', () => {
  test('the text extent is the leftmost word start and the rightmost word end of the page', () => {
    expect(textExtent(null)).toBeNull()
    expect(textExtent({ words: [], lines: [] })).toBeNull()
    expect(
      textExtent({
        words: [
          { t: 'a', x: 80, y: 10, w: 10, h: 10 },
          { t: 'b', x: 60, y: 30, w: 20, h: 10 },
          { t: 'c', x: 100, y: 30, w: 400, h: 10 },
        ],
        lines: [],
      }),
    ).toEqual({ minX: 60, maxX: 500 })
  })

  test('a tag that fits keeps its full text', () => {
    const t = one(cue('a'))
    expect(t.lead).toBe('LX')
    expect(t.tag.x + t.tag.w).toBeLessThanOrEqual(150 - 4)
  })

  test('a standby that is too wide drops its SB prefix first, keeping the dash', () => {
    const full = tagWidth('SB LX', '11')
    const short = tagWidth('LX', '11')
    const limit = 4 + (full + short) / 2 + 4
    const t = one(cue('a', { lead: 'SB LX', number: '11', type: 'standby' }), {
      minX: limit,
      maxX: 450,
    })
    expect(t.lead).toBe('LX')
    expect(t.dash).toBe(true)
    expect(t.tag.w).toBeCloseTo(short)
    expect(t.tag.x + t.tag.w).toBeLessThanOrEqual(limit - 4)
  })

  test('a warn drops its W prefix the same way', () => {
    const limit = 4 + (tagWidth('W LX', '11') + tagWidth('LX', '11')) / 2 + 4
    const t = one(cue('a', { lead: 'W LX', number: '11', type: 'warn' }), {
      minX: limit,
      maxX: 450,
    })
    expect(t.lead).toBe('LX')
    expect(t.outlineWidth).toBe(1.5)
  })

  test('then the department code goes, keeping the number', () => {
    const limit = 4 + (tagWidth('LX', '12.50') + tagWidth('', '12.50')) / 2 + 4
    const t = one(cue('a', { lead: 'W LX', number: '12.50', type: 'warn' }), {
      minX: limit,
      maxX: 450,
    })
    expect(t.lead).toBe('')
    expect(t.number).toBe('12.50')
    expect(t.tag.w).toBeCloseTo(tagWidth('', '12.50'))
    expect(t.numberX).toBeCloseTo(t.tag.x + TAG_PAD)
    expect(t.tag.x + t.tag.w).toBeLessThanOrEqual(limit - 4)
  })

  test('as a last resort the number-only tag sits at the page edge over the text, whole', () => {
    const t = one(cue('a', { number: '12.50' }), { minX: 10, maxX: 450 })
    expect(t.lead).toBe('')
    expect(t.number).toBe('12.50')
    expect(t.tag.x).toBe(4)
  })

  test('the right margin is measured from the text block too', () => {
    const limit = WIDTH - (4 + (tagWidth('SB LX', '11') + tagWidth('LX', '11')) / 2 + 4)
    const t = one(cue('a', { side: 'right', lead: 'SB LX', number: '11', type: 'standby' }), {
      minX: 50,
      maxX: limit,
    })
    expect(t.lead).toBe('LX')
    expect(t.tag.x).toBeGreaterThanOrEqual(limit + 4)
    expect(t.tag.x + t.tag.w).toBeCloseTo(WIDTH - 4)
  })

  test('a page with no word layer assumes a 56 point margin', () => {
    expect(DEFAULT_MARGIN).toBe(56)
    // "SB SND 12.50" is wider than the 52 points between the edge inset and the margin.
    const wide = cue('a', { lead: 'SB SND', code: 'SND', number: '12.50', type: 'standby' })
    expect(tagWidth('SB SND', '12.50')).toBeGreaterThan(52)
    const t = one(wide, null)
    expect(t.tag.x + t.tag.w).toBeLessThanOrEqual(56)
    const r = one({ ...wide, side: 'right' }, null)
    expect(r.tag.x).toBeGreaterThanOrEqual(WIDTH - 56)
  })

  test('stacked tags each fit the margin on their own', () => {
    const limit = 4 + tagWidth('LX', '10') + 4
    const tags = layout(
      [
        cue('a'),
        cue('b', { y: 502, number: '11', sortKey: { department: 0, major: 11, minor: 0 } }),
      ],
      { minX: limit, maxX: 450 },
    )
    for (const t of tags) expect(t.tag.x + t.tag.w).toBeLessThanOrEqual(limit - 4)
  })
})

describe('trigger underline and connector', () => {
  const words = [
    { x: 300, y: 495, w: 40, h: 10 },
    { x: 100, y: 475, w: 60, h: 10 },
  ]

  test('each trigger word box gets a 1.5 pt underline along its bottom edge, 1 pt below it', () => {
    const t = one(cue('a', { triggerBoxes: words }))
    expect(UNDERLINE_WIDTH).toBe(1.5)
    expect(UNDERLINE_DROP).toBe(1)
    expect(t.underlines).toEqual([
      { x1: 300, x2: 340, y: 494 },
      { x1: 100, x2: 160, y: 474 },
    ])
    // The boxes themselves are kept for the on-screen selected fill.
    expect(t.triggerBoxes).toEqual(words)
    expect(t.tick).toBeNull()
  })

  test('level with its line, a left connector runs at the underline y from the tag to the underline start', () => {
    const t = one(cue('a', { triggerBoxes: words }))
    // It starts under the pill's curve (a radius in from the inner edge), so it meets the outline.
    expect(t.leader).toEqual([
      { x: expect.closeTo(t.tag.x + t.tag.w - TAG_RADIUS), y: 494 },
      { x: 300, y: 494 },
    ])
  })

  test('a right connector runs from the tag to the underline end, at the underline y', () => {
    const t = one(cue('a', { side: 'right', triggerBoxes: words }))
    expect(t.leader).toEqual([
      { x: expect.closeTo(t.tag.x + TAG_RADIUS), y: 494 },
      { x: 340, y: 494 },
    ])
  })

  test('the connector joins the first underline, not a later line', () => {
    const t = one(cue('a', { triggerBoxes: [words[1] as (typeof words)[number], ...words] }))
    expect(t.leader?.at(-1)).toEqual({ x: 100, y: 474 })
  })

  test("never crosses glyphs: an underline out of the tag's reach gets three segments through the gutter", () => {
    expect(LEADER_GUTTER).toBe(2)
    // The words sit 12 points below the tag's line, so the straight run would miss the pill.
    const low = [{ x: 300, y: 482, w: 40, h: 10 }]
    const t = one(cue('a', { triggerBoxes: low }))
    // Text block starts at 150: the gutter is 2 points toward the margin.
    expect(t.leader).toEqual([
      { x: expect.closeTo(t.tag.x + t.tag.w), y: 500 },
      { x: 148, y: 500 },
      { x: 148, y: 481 },
      { x: 300, y: 481 },
    ])
    const r = one(cue('a', { side: 'right', triggerBoxes: low }))
    expect(r.leader).toEqual([
      { x: expect.closeTo(r.tag.x), y: 500 },
      { x: 452, y: 500 },
      { x: 452, y: 481 },
      { x: 340, y: 481 },
    ])
  })

  test('with no word layer the gutter is measured from the 56 point margin', () => {
    const low = [{ x: 300, y: 482, w: 40, h: 10 }]
    const t = one(cue('a', { triggerBoxes: low }), null)
    expect(t.leader?.[1]).toEqual({ x: 54, y: 500 })
    const r = one(cue('a', { side: 'right', triggerBoxes: low }), null)
    expect(r.leader?.[1]).toEqual({ x: WIDTH - 54, y: 500 })
  })

  test('no connector when the tag and the underline already meet or overlap', () => {
    const near = { x: 20, y: 495, w: 40, h: 10 }
    expect(one(cue('a', { triggerBoxes: [near] })).leader).toBeNull()
    const nearRight = { x: WIDTH - 60, y: 495, w: 40, h: 10 }
    expect(one(cue('a', { side: 'right', triggerBoxes: [nearRight] })).leader).toBeNull()
  })

  test('an unbound cue has an 8 point tick at its anchor and a connector to its bottom', () => {
    const t = one(cue('a', { anchorX: 250 }))
    expect(t.triggerBoxes).toEqual([])
    expect(t.underlines).toEqual([])
    expect(t.tick).toEqual({ x: 250, y1: 496, y2: 504 })
    expect(t.leader).toEqual([
      { x: expect.closeTo(t.tag.x + t.tag.w - TAG_RADIUS), y: 496 },
      { x: 250, y: 496 },
    ])
    const r = one(cue('a', { side: 'right', anchorX: 250 }))
    expect(r.leader).toEqual([
      { x: expect.closeTo(r.tag.x + TAG_RADIUS), y: 496 },
      { x: 250, y: 496 },
    ])
  })
})
