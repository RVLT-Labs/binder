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

describe('crowding: tags stack in page order, 2 points apart', () => {
  const sort = (department: number, major: number, minor = 0) => ({ department, major, minor })

  test('tags that do not collide stay exactly on their lines', () => {
    const tags = layout([cue('a', { y: 500 }), cue('b', { y: 484 }), cue('c', { y: 400 })])
    expect(tags.map((t) => t.centreY)).toEqual([500, 484, 400])
  })

  test('overlapping tags are stacked 2 points apart in page order, flush at the same x, centred around their lines', () => {
    const [a, b, c] = layout([
      cue('a', { sortKey: sort(0, 10) }),
      cue('b', { y: 500, number: '2', sortKey: sort(1, 2) }),
      cue('c', { y: 498, number: '12', sortKey: sort(1, 3) }),
    ])
    if (!a || !b || !c) throw new Error('tags')
    expect([a.tag.x, b.tag.x, c.tag.x]).toEqual([4, 4, 4])
    expect(TAG_GAP).toBe(2)
    // Lines at 500, 500, 498; stacked 16 apart the group wants its first tag at the mean of
    // 500 + 0, 500 + 16 and 498 + 32, so the three move no further in total than they must.
    const top = (500 + 516 + 530) / 3
    expect(a.centreY).toBeCloseTo(top)
    expect(b.centreY).toBeCloseTo(top - (TAG_HEIGHT + TAG_GAP))
    expect(c.centreY).toBeCloseTo(top - 2 * (TAG_HEIGHT + TAG_GAP))
    expect(a.tag.y - (b.tag.y + b.tag.h)).toBeCloseTo(TAG_GAP)
  })

  test('on the right they stack in the right margin, ending 4 points inside the edge, around their line', () => {
    const [a, b] = layout([
      cue('a', { side: 'right', sortKey: sort(0, 10) }),
      cue('b', { side: 'right', y: 500, number: '11', sortKey: sort(0, 11) }),
    ])
    if (!a || !b) throw new Error('tags')
    expect(a.tag.x + a.tag.w).toBeCloseTo(WIDTH - 4)
    expect(b.tag.x + b.tag.w).toBeCloseTo(WIDTH - 4)
    expect(a.centreY).toBe(500 + (TAG_HEIGHT + TAG_GAP) / 2)
    expect(b.centreY).toBe(500 - (TAG_HEIGHT + TAG_GAP) / 2)
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
    // Page order: line A's two tags first (LX then SND), line B's below both. The three crowd, so
    // they are one group stacked 16 apart around the mean of 400, 416 and 420 (= 412).
    expect(lx10.centreY).toBe(412)
    expect(snd5.centreY).toBe(396)
    expect(lx11.centreY).toBeLessThan(snd5.centreY)
    expect(lx11.centreY).toBe(380)
    // Never in the wrong order down the margin.
    const down = [lx10, snd5, lx11].map((t) => t.centreY)
    expect(down).toEqual([...down].sort((p, q) => q - p))
  })

  test('I1: dense consecutive lines keep their order and drift only as far as they must, around their lines', () => {
    const lines = [400, 388, 376, 364, 352, 340]
    const tags = layout(lines.map((y, i) => cue(`c${i}`, { y, number: String(i) })))
    const centres = tags.map((t) => t.centreY)
    // Strictly top to bottom, in page order, with 2 points between neighbours.
    for (let i = 1; i < centres.length; i++) {
      expect((centres[i - 1] as number) - (centres[i] as number)).toBeGreaterThanOrEqual(TAG_HEIGHT)
    }
    // 12 pt lines: the tags are 16 apart, so the drift is 4 pt a line, shared out above and below
    // the lines: the first tag rises 10 and the last falls 10, and the total displacement is zero.
    expect(centres).toEqual([410, 394, 378, 362, 346, 330])
    expect(centres.reduce((sum, c, i) => sum + c - (lines[i] as number), 0)).toBe(0)
  })

  test('tags a full height apart, or on opposite sides, do not stack', () => {
    const tags = layout([cue('a'), cue('b', { y: 500 - TAG_HEIGHT }), cue('c', { side: 'right' })])
    expect(tags.map((t) => t.centreY)).toEqual([500, 500 - TAG_HEIGHT, 500])
  })

  test('a stacked tag keeps its own connector, which leaves its own tag and jogs to its own underline when the tag is out of reach', () => {
    const boxes = [{ x: 300, y: 495, w: 40, h: 10 }]
    const [a, b] = layout([
      cue('a', { triggerBoxes: boxes, sortKey: sort(0, 1) }),
      cue('b', { triggerBoxes: boxes, y: 500, sortKey: sort(0, 2) }),
    ])
    if (!a || !b) throw new Error('tags')
    // Two cues on the line at 500 spread to 508 and 492. The lower tag still reaches its underline
    // and runs straight out (at the second cue's parallel leader y, 1.5 pt below the first).
    expect(b.centreY).toBeLessThan(a.centreY)
    expect(b.leader?.map((p) => p.y)).toEqual([492.5, 492.5])
    // The one spread above leaves its own tag at the tag's centre and meets its underline in the gutter.
    expect(a.leader?.[0]).toEqual({ x: expect.closeTo(a.tag.x + a.tag.w), y: a.centreY })
    expect(a.leader).toHaveLength(4)
    expect(a.leader?.at(-1)?.y).toBe(494)
    expect(a.underlines[0]?.y).toBe(494)
    expect(b.underlines[0]?.y).toBe(494)
  })
})

describe('spreading: crowded tags spread up and down around their own lines', () => {
  const sort = (department: number, major: number, minor = 0) => ({ department, major, minor })
  const STEP = TAG_HEIGHT + TAG_GAP
  /** n cues of one department on one line, in cue-number order. */
  const onLine = (n: number, y = 500, over: Partial<CueTagInput> = {}) =>
    Array.from({ length: n }, (_, i) =>
      cue(`c${i}`, { y, number: String(i + 1), sortKey: sort(0, i + 1), ...over }),
    )

  test('tags that do not overlap stay exactly on their lines', () => {
    const tags = layout([cue('a', { y: 500 }), cue('b', { y: 484 }), cue('c', { y: 400 })])
    expect(tags.map((t) => t.centreY)).toEqual([500, 484, 400])
    // Two clusters far apart and a lone tag between them: the lone tag does not move.
    const apart = layout([
      ...onLine(2, 700),
      cue('mid', { y: 600, sortKey: sort(0, 50) }),
      ...onLine(2, 500).map((c) => ({ ...c, id: `x${c.id}` })),
    ])
    expect(apart.find((t) => t.id === 'mid')?.centreY).toBe(600)
  })

  test('two cues on one line end up 8 pt above and 8 pt below it, the higher in placement order above', () => {
    const [a, b] = layout(onLine(2))
    expect(a?.centreY).toBe(508)
    expect(b?.centreY).toBe(492)
    expect((a?.centreY ?? 0) - (b?.centreY ?? 0)).toBe(STEP)
  })

  test('three on one line are 16 pt apart centred on the line', () => {
    const [a, b, c] = layout(onLine(3))
    expect([a?.centreY, b?.centreY, c?.centreY]).toEqual([516, 500, 484])
    // Tag centres 16 apart: the gap between neighbouring pills is 2 pt.
    expect((a?.tag.y ?? 0) - ((b?.tag.y ?? 0) + TAG_HEIGHT)).toBeCloseTo(TAG_GAP)
  })

  test("a group's unconstrained total displacement is zero", () => {
    const cases = [
      onLine(4),
      onLine(5, 300),
      [cue('a', { y: 500, sortKey: sort(0, 1) }), cue('b', { y: 497, sortKey: sort(0, 2) })],
      [
        cue('a', { y: 500, sortKey: sort(0, 1) }),
        cue('b', { y: 492, sortKey: sort(0, 2) }),
        cue('c', { y: 480, sortKey: sort(0, 3) }),
        cue('d', { y: 479, sortKey: sort(0, 4) }),
      ],
    ]
    for (const cues of cases) {
      const tags = layout(cues)
      const moved = tags.reduce((sum, t, i) => sum + (t.centreY - (cues[i] as CueTagInput).y), 0)
      expect(moved).toBeCloseTo(0, 9)
    }
  })

  test('groups that overlap after centring merge and re-centre (a lone tag between two clusters)', () => {
    // Two on a line at 520 and two on a line at 480, 40 apart, and one at 500 between them.
    // Each pair spreads to +/-8, which would overlap the middle tag; all five become one group.
    const cues = [
      cue('a1', { y: 520, sortKey: sort(0, 1) }),
      cue('a2', { y: 520, sortKey: sort(0, 2) }),
      cue('m', { y: 500, sortKey: sort(0, 3) }),
      cue('b1', { y: 480, sortKey: sort(0, 4) }),
      cue('b2', { y: 480, sortKey: sort(0, 5) }),
    ]
    const tags = layout(cues)
    const down = tags.map((t) => t.centreY)
    for (let i = 1; i < down.length; i++)
      expect((down[i - 1] as number) - (down[i] as number)).toBeCloseTo(STEP)
    // The merged group is centred: the middle tag, which is on the middle line, stays level.
    expect(down[2]).toBeCloseTo(500)
    expect(down.reduce((s, y, i) => s + y - (cues[i] as CueTagInput).y, 0)).toBeCloseTo(0)
  })

  test('placement order is kept: a tag earlier in the order is never below the next', () => {
    const cues = [
      cue('a', { y: 400, sortKey: sort(0, 1) }),
      cue('b', { y: 396, sortKey: sort(0, 2) }),
      cue('c', { y: 392, sortKey: sort(0, 3) }),
      cue('d', { y: 350, sortKey: sort(0, 4) }),
      cue('e', { y: 349, sortKey: sort(0, 5) }),
    ]
    const tags = layout(cues)
    for (let i = 1; i < tags.length; i++)
      expect((tags[i - 1] as CueTagLayout).centreY).toBeGreaterThan(
        (tags[i] as CueTagLayout).centreY,
      )
  })

  test('within a group the spacing is exactly TAG_HEIGHT + TAG_GAP (+ NOTE_HEIGHT under a noted tag) and between groups tags never overlap', () => {
    const cues = [
      cue('a', { y: 600, sortKey: sort(0, 1) }),
      cue('b', { y: 598, sortKey: sort(0, 2), note: 'Ride the pad' }),
      cue('c', { y: 597, sortKey: sort(0, 3) }),
      cue('d', { y: 500, sortKey: sort(0, 4) }),
      cue('e', { y: 499, sortKey: sort(0, 5) }),
      cue('f', { y: 400, sortKey: sort(0, 6) }),
    ]
    const [a, b, c, d, e, f] = layout(cues) as CueTagLayout[] as [
      CueTagLayout,
      CueTagLayout,
      CueTagLayout,
      CueTagLayout,
      CueTagLayout,
      CueTagLayout,
    ]
    expect(a.centreY - b.centreY).toBeCloseTo(STEP)
    expect(b.centreY - c.centreY).toBeCloseTo(STEP + NOTE_HEIGHT)
    expect(d.centreY - e.centreY).toBeCloseTo(STEP)
    expect(f.centreY).toBe(400)
    // Between groups: c's bottom edge is far above d's top edge.
    for (const [hi, lo] of [
      [c, d],
      [e, f],
    ] as const)
      expect(hi.centreY - lo.centreY).toBeGreaterThanOrEqual(TAG_HEIGHT)
  })

  test('a group near the footer is lifted off it, a group at the top is held on the page, and a cluster squeezed between them still stays on the page', () => {
    const floor = 19
    const near = layout(onLine(3, 22), WIDE, { minY: floor, maxY: 800 })
    // Spread around 22 the lowest would sit at 6, under the footer: the stack is lifted 20 pt.
    expect(near.map((t) => t.centreY)).toEqual([58, 42, 26])
    for (const t of near) expect(t.tag.y).toBeGreaterThanOrEqual(floor)
    // Lifted just enough: the lowest tag rests on the footer.
    expect(Math.min(...near.map((t) => t.tag.y))).toBeCloseTo(floor)
    expect(near.map((t) => t.id)).toEqual(['c0', 'c1', 'c2'])
    expect(near[0]?.centreY).toBeGreaterThan(near[1]?.centreY ?? 0)
    expect(near[1]?.centreY).toBeGreaterThan(near[2]?.centreY ?? 0)
    const top = layout(onLine(3, 797), WIDE, { minY: 0, maxY: 800 })
    for (const t of top) expect(t.tag.y + t.tag.h).toBeLessThanOrEqual(800)
    expect(Math.max(...top.map((t) => t.tag.y + t.tag.h))).toBeCloseTo(800)
    const squeezed = layout(onLine(5, 40), WIDE, { minY: 19, maxY: 70 })
    for (const t of squeezed) {
      expect(t.tag.y).toBeGreaterThanOrEqual(19)
      expect(t.tag.y + t.tag.h).toBeLessThanOrEqual(70)
    }
  })

  test('input order does not matter', () => {
    const cues = [
      ...onLine(3, 500),
      cue('x', { y: 497, number: '9', sortKey: sort(1, 9) }),
      cue('y', { y: 300, number: '8', sortKey: sort(0, 8) }),
    ]
    const byId = (list: CueTagInput[]) =>
      Object.fromEntries(layout(list).map((t) => [t.id, t.centreY]))
    const forward = byId(cues)
    expect(byId([...cues].reverse())).toEqual(forward)
    expect(byId([cues[3], cues[0], cues[4], cues[2], cues[1]] as CueTagInput[])).toEqual(forward)
  })

  test('right-side tags spread the same way, and the two sides are independent', () => {
    const left = layout(onLine(3))
    const right = layout(onLine(3, 500, { side: 'right' }))
    expect(right.map((t) => t.centreY)).toEqual(left.map((t) => t.centreY))
    for (const t of right) expect(t.tag.x + t.tag.w).toBeCloseTo(WIDTH - 4)
    const both = layout([...onLine(3), cue('r', { side: 'right', y: 500 })])
    expect(both[3]?.centreY).toBe(500)
    expect(both.slice(0, 3).map((t) => t.centreY)).toEqual([516, 500, 484])
  })

  test('any mix of lines keeps the order and never overlaps tags or notes (a seeded scatter)', () => {
    let seed = 12345
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let round = 0; round < 40; round++) {
      const n = 2 + Math.floor(next() * 14)
      const cues = Array.from({ length: n }, (_, i) =>
        cue(`c${i}`, {
          y: 200 + Math.round(next() * 300),
          number: String(i),
          sortKey: sort(0, i),
          note: next() < 0.3 ? 'Ride the pad' : undefined,
        }),
      )
      const tags = layout(cues, WIDE, { minY: 0, maxY: 2000 }) as CueTagLayout[]
      const down = [...tags].sort((p, q) => q.centreY - p.centreY)
      for (let i = 1; i < down.length; i++) {
        const upper = down[i - 1] as CueTagLayout
        const lower = down[i] as CueTagLayout
        const held = upper.note ? NOTE_HEIGHT : 0
        expect(upper.centreY - lower.centreY).toBeGreaterThanOrEqual(TAG_HEIGHT + held - 1e-9)
      }
      // The order down the page is placement order: higher line first, then cue number.
      const placement = [...cues].sort((p, q) => q.y - p.y || p.sortKey.major - q.sortKey.major)
      expect(down.map((t) => t.id)).toEqual(placement.map((c) => c.id))
    }
  })

  test('a spread tag keeps its connector: it leaves its own tag and jogs to its own underline, above or below the line', () => {
    const boxes = [{ x: 300, y: 495, w: 40, h: 10 }]
    const tags = layout(
      [1, 2, 3, 4].map((n) => cue(`c${n}`, { triggerBoxes: boxes, sortKey: sort(0, n) })),
    ) as CueTagLayout[]
    const [a, , , d] = tags as [CueTagLayout, CueTagLayout, CueTagLayout, CueTagLayout]
    // Four on the line at 500 sit at 524, 508, 492 and 476; the underline is at y = 494.
    expect(tags.map((t) => t.centreY)).toEqual([524, 508, 492, 476])
    // The first is above the line and the last below it, both out of reach: each leaves its own
    // tag at its centre and jogs through the gutter to its own underline.
    for (const t of [a, d]) {
      expect(t.leader?.[0]).toEqual({ x: expect.closeTo(t.tag.x + t.tag.w), y: t.centreY })
      expect(t.leader).toHaveLength(4)
      expect(t.underlines[0]?.y).toBe(494)
    }
    // Parallel leaders still rank by placement order, 1.5 pt apart.
    expect(tags.map((t) => t.leader?.at(-1)?.y)).toEqual([494, 492.5, 491, 489.5])
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

  test('five cues on a line at y = 40 all end above the footer, in page order, without overlapping', () => {
    const tags = layout(
      [0, 1, 2, 3, 4].map((i) =>
        cue(`c${i}`, {
          y: 40,
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
    // Spread around y = 40 (16 apart) they would run from 72 down to 8, the lowest tag's bottom
    // edge at 1, under the footer (19): the whole stack is lifted 18 pt until it rests on it.
    expect(down.map((t) => t.centreY)).toEqual([90, 74, 58, 42, 26])
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
    // The three crowd into one group, centred on where they want to be: a at 500, b at 500 and c at
    // 495 stacked 25 and 25 apart (a and b carry notes) want their first tag at (500 + 525 + 545) / 3.
    expect(a.centreY).toBeCloseTo((500 + 525 + 545) / 3)
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
