import { describe, expect, test } from 'vitest'
import {
  BAR_OVERHANG,
  BAR_WIDTH,
  barAt,
  type CueTagInput,
  type CueTagLayout,
  DEFAULT_MARGIN,
  FREE_BAR_HEIGHT,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_OPACITY_ACTIVE,
  HIGHLIGHT_PAD_X,
  HIGHLIGHT_RADIUS,
  LEADER_GUTTER,
  LEADER_STEP,
  layoutCueTags,
  NOTE_COLUMN_INSET,
  NOTE_FONT_SIZE,
  NOTE_HEIGHT,
  NOTE_MIN_COLUMN,
  POINTER_HEIGHT,
  POINTER_WIDTH,
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
  typeWord: '',
  number: '10',
  triggerBoxes: [],
  anchorX: 200,
  sortKey: { department: 0, major: 10, minor: 0 },
  ...over,
})

/** A wide margin on both sides, so only the tests about the margin are about it. */
const WIDE = { minX: 150, maxX: 450 }
const BOUNDS = { minY: 0, maxY: 800 }
const layout = (
  cues: CueTagInput[],
  extent: { minX: number; maxX: number } | null = WIDE,
  bounds = BOUNDS,
) => layoutCueTags({ pageWidth: WIDTH, bounds, textExtent: extent, cues })
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
    const t = one(cue('a', { lead: 'SB LX', typeWord: 'SB', number: '14.5', type: 'standby' }))
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

describe('crowding: a collision sweep down the page, in page order', () => {
  const sort = (department: number, major: number, minor = 0) => ({ department, major, minor })

  test('tags that do not collide stay exactly on their lines', () => {
    const tags = layout([cue('a', { y: 500 }), cue('b', { y: 484 }), cue('c', { y: 400 })])
    expect(tags.map((t) => t.centreY)).toEqual([500, 484, 400])
  })

  test('a tag that would overlap the one above is pushed to 2 points below it, flush at the same x', () => {
    const [a, b, c] = layout([
      cue('a', { sortKey: sort(0, 10) }),
      cue('b', { y: 500, number: '2', sortKey: sort(1, 2) }),
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
      cue('b', { side: 'right', y: 500, number: '11', sortKey: sort(0, 11) }),
    ])
    if (!a || !b) throw new Error('tags')
    expect(a.tag.x + a.tag.w).toBeCloseTo(WIDTH - 4)
    expect(b.tag.x + b.tag.w).toBeCloseTo(WIDTH - 4)
    expect(b.centreY).toBe(500 - (TAG_HEIGHT + TAG_GAP))
  })

  test('on one line the order is department sort order, then cue number, then id, whatever the input order', () => {
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

  test('I1: a cue on a lower line never ends up under a tag that belongs to the line below', () => {
    // LX 10 on line A (400), LX 11 on line B (388, 12 pt lower), SND 5 on line A (400).
    const [lx10, lx11, snd5] = layout([
      cue('lx10', { y: 400, sortKey: sort(0, 10) }),
      cue('lx11', { y: 388, number: '11', sortKey: sort(0, 11) }),
      cue('snd5', { y: 400, number: '5', sortKey: sort(1, 5) }),
    ])
    if (!lx10 || !lx11 || !snd5) throw new Error('tags')
    // Page order: line A's two tags first (LX then SND), line B's below both.
    expect(lx10.centreY).toBe(400)
    expect(snd5.centreY).toBe(384)
    expect(lx11.centreY).toBeLessThan(snd5.centreY)
    expect(lx11.centreY).toBe(368)
    // Never in the wrong order down the margin.
    const down = [lx10, snd5, lx11].map((t) => t.centreY)
    expect(down).toEqual([...down].sort((p, q) => q - p))
  })

  test('I1: dense consecutive lines keep their order and drift only as far as they must', () => {
    const lines = [400, 388, 376, 364, 352, 340]
    const tags = layout(lines.map((y, i) => cue(`c${i}`, { y, number: String(i) })))
    const centres = tags.map((t) => t.centreY)
    // Strictly top to bottom, in page order, with 2 points between neighbours.
    for (let i = 1; i < centres.length; i++) {
      expect((centres[i - 1] as number) - (centres[i] as number)).toBeGreaterThanOrEqual(TAG_HEIGHT)
    }
    // 12 pt lines: each tag is pushed to 16 below the one above, so the drift is 4 pt a line.
    expect(centres).toEqual([400, 384, 368, 352, 336, 320])
  })

  test('tags a full height apart, or on opposite sides, do not stack', () => {
    const tags = layout([cue('a'), cue('b', { y: 500 - TAG_HEIGHT }), cue('c', { side: 'right' })])
    expect(tags.map((t) => t.centreY)).toEqual([500, 500 - TAG_HEIGHT, 500])
  })

  test('a stacked tag keeps its own connector, which leaves its own tag and jogs to its own underline', () => {
    const boxes = [{ x: 300, y: 495, w: 40, h: 10 }]
    const [a, b] = layout([
      cue('a', { triggerBoxes: boxes, sortKey: sort(0, 1) }),
      cue('b', { triggerBoxes: boxes, y: 500, sortKey: sort(0, 2) }),
    ])
    if (!a || !b) throw new Error('tags')
    // The tag on its own line runs straight out to its underline.
    expect(a.leader?.map((p) => p.y)).toEqual([494, 494])
    // The pushed one leaves its tag at the tag's centre and meets the underline in the gutter.
    expect(b.leader?.[0]).toEqual({ x: expect.closeTo(b.tag.x + b.tag.w), y: b.centreY })
    expect(b.leader).toHaveLength(4)
    expect(b.centreY).toBeLessThan(a.centreY)
    expect(b.underlines[0]?.y).toBe(494)
  })
})

describe('I4: cues on one line get parallel leaders 1.5 pt apart', () => {
  const sort = (department: number, major: number) => ({ department, major, minor: 0 })

  test('the second and later cues on a side run 1.5 pt below the previous cue, in placement order', () => {
    const [a, b, c] = layout([
      cue('a', { triggerBoxes: [{ x: 300, y: 495, w: 40, h: 10 }], sortKey: sort(0, 1) }),
      cue('b', { triggerBoxes: [{ x: 200, y: 495, w: 40, h: 10 }], sortKey: sort(1, 2) }),
      cue('c', { triggerBoxes: [{ x: 250, y: 495, w: 40, h: 10 }], sortKey: sort(2, 3) }),
    ])
    if (!a || !b || !c) throw new Error('tags')
    expect(LEADER_STEP).toBe(1.5)
    expect(a.leader?.at(-1)?.y).toBe(494)
    expect(b.leader?.at(-1)?.y).toBe(492.5)
    expect(c.leader?.at(-1)?.y).toBe(491)
    // They end at their own underlines' starts.
    expect([a, b, c].map((t) => t.leader?.at(-1)?.x)).toEqual([300, 200, 250])
  })

  test('cues on different lines, or on opposite sides, keep their natural leader y', () => {
    const tags = layout([
      cue('a', { y: 500, triggerBoxes: [{ x: 300, y: 495, w: 40, h: 10 }] }),
      cue('b', { y: 400, triggerBoxes: [{ x: 300, y: 395, w: 40, h: 10 }] }),
      cue('c', { y: 500, side: 'right', triggerBoxes: [{ x: 300, y: 495, w: 40, h: 10 }] }),
    ])
    expect(tags.map((t) => t.leader?.at(-1)?.y)).toEqual([494, 394, 494])
  })
})

describe('I2: tags never leave the page or sit under the footer', () => {
  const FOOTER_TOP = 19

  test('five cues on a line at y = 60 all end above the footer, in page order, without overlapping', () => {
    const tags = layout(
      [0, 1, 2, 3, 4].map((i) =>
        cue(`c${i}`, {
          y: 60,
          number: String(i + 1),
          sortKey: { department: i, major: i, minor: 0 },
        }),
      ),
      WIDE,
      { minY: FOOTER_TOP, maxY: 800 },
    )
    for (const t of tags) expect(t.tag.y).toBeGreaterThanOrEqual(FOOTER_TOP)
    const down = [...tags].sort((p, q) => q.centreY - p.centreY)
    expect(down.map((t) => t.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
    for (let i = 1; i < down.length; i++) {
      expect(
        (down[i - 1]?.tag.y ?? 0) - ((down[i]?.tag.y ?? 0) + TAG_HEIGHT),
      ).toBeGreaterThanOrEqual(TAG_GAP - 1e-9)
    }
  })

  test('a lone tag below the floor is lifted to it', () => {
    const [t] = layout([cue('a', { y: 3 })], WIDE, { minY: FOOTER_TOP, maxY: 800 })
    expect(t?.tag.y).toBe(FOOTER_TOP)
  })

  test('nothing goes above the top of the page, even if a cluster has to overlap there', () => {
    const tags = layout(
      [0, 1, 2, 3, 4, 5].map((i) =>
        cue(`c${i}`, { y: 795, sortKey: { department: i, major: i, minor: 0 } }),
      ),
      WIDE,
      { minY: 0, maxY: 800 },
    )
    for (const t of tags) expect(t.tag.y + t.tag.h).toBeLessThanOrEqual(800)
    for (const t of tags) expect(t.tag.y).toBeGreaterThanOrEqual(0)
  })

  test('a cluster squeezed between the floor and the top still stays on the page', () => {
    const tags = layout(
      [0, 1, 2, 3, 4].map((i) =>
        cue(`c${i}`, { y: 40, sortKey: { department: i, major: i, minor: 0 } }),
      ),
      WIDE,
      { minY: 19, maxY: 70 },
    )
    for (const t of tags) {
      expect(t.tag.y).toBeGreaterThanOrEqual(19)
      expect(t.tag.y + t.tag.h).toBeLessThanOrEqual(70)
    }
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

  test('a stray word in the margin does not move it: only lines of three or more words count', () => {
    const solid = [0, 1, 2].map((i) => ({ t: 'w', x: 100 + i * 50, y: 500, w: 40, h: 10 }))
    const stray = { t: '7', x: 12, y: 500, w: 6, h: 10 }
    expect(textExtent({ words: [stray, ...solid], lines: [[0], [1, 2, 3]] })).toEqual({
      minX: 100,
      maxX: 240,
    })
    // No line of three words: every word counts.
    expect(textExtent({ words: [stray, ...solid.slice(0, 1)], lines: [[0], [1]] })).toEqual({
      minX: 12,
      maxX: 140,
    })
  })

  test('a tag that fits keeps its full text', () => {
    const t = one(cue('a'))
    expect(t.lead).toBe('LX')
    expect(t.tag.x + t.tag.w).toBeLessThanOrEqual(150 - 4)
  })

  test('a standby that does not fit drops its department first and keeps the SB word and the dash', () => {
    const full = tagWidth('SB LX', '11')
    const typeOnly = tagWidth('SB', '11')
    const limit = 4 + (full + typeOnly) / 2 + 4
    const t = one(cue('a', { lead: 'SB LX', typeWord: 'SB', number: '11', type: 'standby' }), {
      minX: limit,
      maxX: 450,
    })
    expect(t.lead).toBe('SB')
    expect(t.dash).toBe(true)
    expect(t.tag.w).toBeCloseTo(typeOnly)
    expect(t.tag.x + t.tag.w).toBeLessThanOrEqual(limit - 4)
  })

  test('a warn drops its department the same way and keeps W and its heavier outline', () => {
    const limit = 4 + (tagWidth('W LX', '11') + tagWidth('W', '11')) / 2 + 4
    const t = one(cue('a', { lead: 'W LX', typeWord: 'W', number: '11', type: 'warn' }), {
      minX: limit,
      maxX: 450,
    })
    expect(t.lead).toBe('W')
    expect(t.outlineWidth).toBe(1.5)
  })

  test('then the type word goes too, keeping the number whole', () => {
    const limit = 4 + (tagWidth('W', '12.50') + tagWidth('', '12.50')) / 2 + 4
    const t = one(cue('a', { lead: 'W LX', typeWord: 'W', number: '12.50', type: 'warn' }), {
      minX: limit,
      maxX: 450,
    })
    expect(t.lead).toBe('')
    expect(t.number).toBe('12.50')
    expect(t.tag.w).toBeCloseTo(tagWidth('', '12.50'))
    expect(t.numberX).toBeCloseTo(t.tag.x + TAG_PAD)
    expect(t.tag.x + t.tag.w).toBeLessThanOrEqual(limit - 4)
  })

  test('a go has no type word: it goes from "LX 11" straight to "11"', () => {
    const limit = 4 + (tagWidth('LX', '11') + tagWidth('', '11')) / 2 + 4
    const t = one(cue('a', { number: '11' }), { minX: limit, maxX: 450 })
    expect(t.lead).toBe('')
  })

  test('as a last resort the number-only tag sits at the page edge over the text, whole', () => {
    const t = one(cue('a', { number: '12.50' }), { minX: 10, maxX: 450 })
    expect(t.lead).toBe('')
    expect(t.number).toBe('12.50')
    expect(t.tag.x).toBe(4)
  })

  test('the right margin is measured from the text block too', () => {
    const limit = WIDTH - (4 + (tagWidth('SB LX', '11') + tagWidth('SB', '11')) / 2 + 4)
    const t = one(
      cue('a', { side: 'right', lead: 'SB LX', typeWord: 'SB', number: '11', type: 'standby' }),
      { minX: 50, maxX: limit },
    )
    expect(t.lead).toBe('SB')
    expect(t.tag.x).toBeGreaterThanOrEqual(limit + 4)
    expect(t.tag.x + t.tag.w).toBeCloseTo(WIDTH - 4)
  })

  test('a page with no word layer assumes a 56 point margin', () => {
    expect(DEFAULT_MARGIN).toBe(56)
    // "SB SND 12.50" is wider than the 52 points between the edge inset and the margin.
    const wide = cue('a', { lead: 'SB SND', typeWord: 'SB', number: '12.50', type: 'standby' })
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

  test('an unbound cue has an 11 point tick from 4 above its anchor to 7 below, the connector at its bottom', () => {
    const t = one(cue('a', { anchorX: 250 }))
    expect(t.triggerBoxes).toEqual([])
    expect(t.underlines).toEqual([])
    expect(t.tick).toEqual({ x: 250, y1: 493, y2: 504 })
    expect(t.leader).toEqual([
      { x: expect.closeTo(t.tag.x + t.tag.w - TAG_RADIUS), y: 493 },
      { x: 250, y: 493 },
    ])
    const r = one(cue('a', { side: 'right', anchorX: 250 }))
    expect(r.leader).toEqual([
      { x: expect.closeTo(r.tag.x + TAG_RADIUS), y: 493 },
      { x: 250, y: 493 },
    ])
  })

  test('a taller word box still runs straight: the jog needs the underline more than 1 point out of reach', () => {
    // A 13 pt word box on the line: its underline is 7.5 below the centre (the tag reaches 7).
    const tall = [{ x: 300, y: 493.5, w: 40, h: 13 }]
    expect(one(cue('a', { triggerBoxes: tall })).leader).toHaveLength(2)
    // 2 points beyond the pill's reach is out of reach: it jogs.
    const lower = [{ x: 300, y: 490, w: 40, h: 13 }]
    expect(one(cue('a', { triggerBoxes: lower })).leader).toHaveLength(4)
  })
})

describe('cue notes', () => {
  const NOTE = 'Ride the pad under the dialogue'

  test('a note sits in a 9 pt block directly under its tag, flush with the tag on the left', () => {
    expect([NOTE_FONT_SIZE, NOTE_HEIGHT, NOTE_MIN_COLUMN, NOTE_COLUMN_INSET]).toEqual([7, 9, 40, 8])
    const t = one(cue('a', { note: 'Ride the pad' }))
    if (!t.note) throw new Error('no note')
    expect(t.note.text).toBe('Ride the pad')
    expect(t.note.box.x).toBe(t.tag.x)
    expect(t.note.box.y).toBe(t.tag.y - NOTE_HEIGHT)
    expect(t.note.box.h).toBe(NOTE_HEIGHT)
    expect(t.note.box.w).toBeCloseTo(helveticaWidth('Ride the pad', NOTE_FONT_SIZE))
  })

  test('on the right the note ends where the tag does', () => {
    const t = one(cue('a', { side: 'right', note: 'Ride the pad' }))
    if (!t.note) throw new Error('no note')
    expect(t.note.box.x + t.note.box.w).toBeCloseTo(WIDTH - TAG_EDGE)
    expect(t.note.box.y).toBe(t.tag.y - NOTE_HEIGHT)
  })

  test('is cut with an ellipsis to the column: the margin between the page edge and the text, less 8', () => {
    // minX 100: a column of 92 pt.
    const t = one(cue('a', { note: NOTE.repeat(3) }), { minX: 100, maxX: 450 })
    if (!t.note) throw new Error('no note')
    expect(t.note.text.endsWith('…')).toBe(true)
    expect(t.note.text.length).toBeLessThan(NOTE.length * 3)
    expect(t.note.box.w).toBeLessThanOrEqual(92 + 1e-9)
    // It is the longest cut that fits: one more character would not.
    const longer = NOTE.repeat(3).slice(0, t.note.text.length)
    expect(helveticaWidth(`${longer}…`, NOTE_FONT_SIZE)).toBeGreaterThan(92)
    // On the right the column is the margin right of the text block.
    const r = one(cue('b', { side: 'right', note: NOTE.repeat(3) }), { minX: 150, maxX: 508 })
    expect(r.note?.box.w).toBeLessThanOrEqual(92 + 1e-9)
    // A note that fits is not touched.
    expect(one(cue('c', { note: 'Go' })).note?.text).toBe('Go')
  })

  test('is not drawn when the column is narrower than 40 pt', () => {
    expect(one(cue('a', { note: NOTE }), { minX: 36, maxX: 450 }).note).toBeNull()
    expect(one(cue('b', { note: NOTE }), { minX: 47.9, maxX: 450 }).note).toBeNull()
    expect(one(cue('c', { note: NOTE }), { minX: 48, maxX: 450 }).note).not.toBeNull()
    expect(
      one(cue('d', { side: 'right', note: NOTE }), { minX: 150, maxX: WIDTH - 36 }).note,
    ).toBeNull()
    // A page with no word layer assumes the 56 pt default margin.
    expect(one(cue('e', { note: NOTE }), null).note).not.toBeNull()
  })

  test('a cue with no note, or an empty one, has none and moves nothing', () => {
    const plain = one(cue('a'))
    expect(plain.note).toBeNull()
    expect(one(cue('b', { note: '' })).note).toBeNull()
    expect(one(cue('c', { note: NOTE })).tag).toEqual(plain.tag)
  })

  test('a tag with a note counts as tag height + 9 in the stack: stacked tags never overlap a note', () => {
    const [a, b, c] = layout([
      cue('a', { y: 500, note: NOTE }),
      cue('b', { y: 500, note: NOTE, sortKey: { department: 0, major: 11, minor: 0 } }),
      cue('c', { y: 495, sortKey: { department: 0, major: 12, minor: 0 } }),
    ]) as [CueTagLayout, CueTagLayout, CueTagLayout]
    const noteA = a.note as NonNullable<CueTagLayout['note']>
    // b starts 2 pt under a's note, not under a's tag.
    expect(b.tag.y + b.tag.h).toBeCloseTo(noteA.box.y - TAG_GAP)
    expect(a.centreY - b.centreY).toBe(TAG_HEIGHT + NOTE_HEIGHT + TAG_GAP)
    const noteB = b.note as NonNullable<CueTagLayout['note']>
    expect(c.tag.y + c.tag.h).toBeCloseTo(noteB.box.y - TAG_GAP)
    // No tag or note box touches another.
    const boxes = [a.tag, noteA.box, b.tag, noteB.box, c.tag]
    for (const [i, p] of boxes.entries())
      for (const q of boxes.slice(i + 1))
        expect(p.y >= q.y + q.h || q.y >= p.y + p.h || p.x >= q.x + q.w || q.x >= p.x + p.w).toBe(
          true,
        )
  })

  test('tags well apart stay on their own lines, and a note-less tag below a noted one clears it', () => {
    const [a, b] = layout([cue('a', { y: 500, note: NOTE }), cue('b', { y: 460 })]) as [
      CueTagLayout,
      CueTagLayout,
    ]
    expect(b.centreY).toBe(460)
    const [c, d] = layout([
      cue('c', { y: 500, note: NOTE }),
      cue('d', { y: 480, sortKey: { department: 0, major: 11, minor: 0 } }),
    ]) as [CueTagLayout, CueTagLayout]
    // 20 pt apart would clear a bare tag, but not a noted one (23 pt).
    expect(d.centreY).toBe(c.centreY - (TAG_HEIGHT + NOTE_HEIGHT + TAG_GAP))
    expect(a.note).not.toBeNull()
  })

  test('the stack held above the footer keeps the note of the lowest tag above it too', () => {
    const [t] = layout([cue('a', { y: 3, note: NOTE })], WIDE, { minY: 19, maxY: 800 }) as [
      CueTagLayout,
    ]
    expect(t.note?.box.y).toBeGreaterThanOrEqual(19)
  })
})

describe('cue marks: highlight, line and pointer', () => {
  const word = { x: 300, y: 495, w: 40, h: 10 }
  const caret = { x: 320, box: word }

  test('barAt is the bar at a caret: the word box plus the overhang each side', () => {
    expect(barAt({ x: 40, box: { x: 30, y: 495, w: 20, h: 10 } })).toEqual({
      x: 40,
      y1: 495 - BAR_OVERHANG,
      y2: 505 + BAR_OVERHANG,
    })
  })

  test('the mark constants', () => {
    expect(HIGHLIGHT_OPACITY).toBe(0.28)
    expect(HIGHLIGHT_OPACITY_ACTIVE).toBe(0.4)
    expect(HIGHLIGHT_RADIUS).toBe(2)
    expect(HIGHLIGHT_PAD_X).toBe(1)
    expect(BAR_WIDTH).toBe(1.5)
    expect(BAR_OVERHANG).toBe(3)
    expect(POINTER_WIDTH).toBe(6)
    expect(POINTER_HEIGHT).toBe(5)
    expect(FREE_BAR_HEIGHT).toBe(14)
  })

  test('underline: a cue with no mark is an underline, with no fills and no bar', () => {
    const t = one(cue('a', { triggerBoxes: [word] }))
    expect(t.mark).toBe('underline')
    expect(t.fills).toEqual([])
    expect(t.bar).toBeNull()
    expect(t.underlines).toHaveLength(1)
    expect(one(cue('a', { mark: 'underline', triggerBoxes: [word] }))).toEqual(t)
  })

  test('highlight: one padded fill per trigger box, no underlines, no tick; the leader ends at the first box outer edge', () => {
    const low = { x: 100, y: 475, w: 60, h: 10 }
    const t = one(cue('a', { mark: 'highlight', triggerBoxes: [word, low] }))
    expect(t.mark).toBe('highlight')
    expect(t.fills).toEqual([
      { x: 299, y: 495, w: 42, h: 10 },
      { x: 99, y: 475, w: 62, h: 10 },
    ])
    expect(t.triggerBoxes).toEqual([word, low])
    expect(t.underlines).toEqual([])
    expect(t.tick).toBeNull()
    expect(t.bar).toBeNull()
    expect(t.leader?.at(-1)).toEqual({ x: 299, y: 494 })
    const r = one(cue('a', { side: 'right', mark: 'highlight', triggerBoxes: [word, low] }))
    expect(r.leader?.at(-1)).toEqual({ x: 341, y: 494 })
  })

  test('highlight with no trigger boxes falls back to the tick', () => {
    const t = one(cue('a', { mark: 'highlight', anchorX: 250 }))
    expect(t.fills).toEqual([])
    expect(t.underlines).toEqual([])
    expect(t.tick).toEqual({ x: 250, y1: 493, y2: 504 })
    expect(t.leader?.at(-1)).toEqual({ x: 250, y: 493 })
  })

  test('line: the bar is at the caret x, the word height plus the overhang each end; the leader ends at it', () => {
    const t = one(cue('a', { mark: 'line', triggerBoxes: [word], caret }))
    expect(t.mark).toBe('line')
    expect(t.bar).toEqual({
      x: 320,
      y1: 495 - BAR_OVERHANG,
      y2: 505 + BAR_OVERHANG,
      pointer: false,
    })
    expect(t.underlines).toEqual([])
    expect(t.tick).toBeNull()
    expect(t.fills).toEqual([])
    expect(t.triggerBoxes).toEqual([word])
    expect(t.leader?.at(-1)).toEqual({ x: 320, y: 494 })
    const r = one(cue('a', { side: 'right', mark: 'line', triggerBoxes: [word], caret }))
    expect(r.leader?.at(-1)).toEqual({ x: 320, y: 494 })
  })

  test('pointer: the same bar with pointer true', () => {
    const t = one(cue('a', { mark: 'pointer', triggerBoxes: [word], caret }))
    expect(t.mark).toBe('pointer')
    expect(t.bar).toEqual({ x: 320, y1: 492, y2: 508, pointer: true })
    expect(t.underlines).toEqual([])
    expect(t.tick).toBeNull()
    expect(t.leader?.at(-1)).toEqual({ x: 320, y: 494 })
  })

  test('line with no caret: a free bar of FREE_BAR_HEIGHT centred on y at anchorX, the leader ends at its bottom', () => {
    const t = one(cue('a', { mark: 'line', anchorX: 250 }))
    expect(t.bar).toEqual({ x: 250, y1: 493, y2: 507, pointer: false })
    expect(t.bar && t.bar.y2 - t.bar.y1).toBe(FREE_BAR_HEIGHT)
    expect(t.tick).toBeNull()
    expect(t.underlines).toEqual([])
    expect(t.leader?.at(-1)).toEqual({ x: 250, y: 493 })
    const p = one(cue('a', { mark: 'pointer', anchorX: 250 }))
    expect(p.bar).toEqual({ x: 250, y1: 493, y2: 507, pointer: true })
  })

  test('a line right of the tag edge on a left tag draws a leader; a bar under the tag draws none', () => {
    const far = one(cue('a', { mark: 'line', triggerBoxes: [word], caret }))
    expect(far.leader).not.toBeNull()
    const under = { x: 10, y: 495, w: 40, h: 10 }
    const near = one(
      cue('a', { mark: 'line', triggerBoxes: [under], caret: { x: 12, box: under } }),
    )
    expect(near.bar?.x).toBe(12)
    expect(near.leader).toBeNull()
  })

  test('leaders of two marks on one line still stagger by LEADER_STEP', () => {
    const [a, b] = layout([
      cue('a', {
        mark: 'line',
        triggerBoxes: [word],
        caret,
        sortKey: { department: 0, major: 1, minor: 0 },
      }),
      cue('b', {
        mark: 'highlight',
        triggerBoxes: [word],
        sortKey: { department: 0, major: 2, minor: 0 },
      }),
    ]) as [CueTagLayout, CueTagLayout]
    expect(a.leader?.at(-1)?.y).toBe(494)
    expect(b.leader?.at(-1)?.y).toBeCloseTo(494 - LEADER_STEP)
  })
})
