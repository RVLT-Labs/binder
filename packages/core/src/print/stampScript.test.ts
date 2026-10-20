import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import { pdfContent, pdfTexts } from '../../test/pdfTexts'
import type { StampItem } from './stampItems'
import { displayedToUser, frameOf, stampScript } from './stampScript'

const footer = {
  showTitle: 'Pirates',
  documentLabel: 'Libretto v2',
  layerLabel: 'LX',
  binderVersion: 3,
  exportId: 'x',
  date: new Date(2026, 9, 15, 14, 2),
}

// An offset box (bx 50, by 60) 200 wide and 300 tall, unrotated.
const frame = { bx: 50, by: 60, w: 200, h: 300 }

test.each([
  [0, { x: 50 + 10, y: 60 + 20 }],
  [90, { x: 50 + 200 - 20, y: 60 + 10 }],
  [180, { x: 50 + 200 - 10, y: 60 + 300 - 20 }],
  [270, { x: 50 + 20, y: 60 + 300 - 10 }],
] as const)('displayed (10, 20) at /Rotate %i maps to user space per the table', (rotation, p) =>
  expect(displayedToUser({ ...frame, rotation }, 10, 20)).toEqual(p),
)

test('stamping keeps every page box and rotation and draws the footer on each page', async () => {
  const src = await PDFDocument.create()
  const a = src.addPage([300, 400])
  a.setCropBox(20, 30, 200, 300)
  const b = src.addPage([500, 200])
  b.setRotation(degrees(270))
  const out = await stampScript(
    await src.save(),
    [
      {
        kind: 'cue',
        id: 'a',
        pageIndex: 1,
        x: 40,
        y: 100,
        type: 'warn',
        lead: 'W LX ✓',
        typeWord: 'W',
        number: '10',
        numberInk: '#1A1715',
        colour: '#F5A623',
        side: 'right',
        sortKey: { department: 0, major: 10, minor: 0 },
        triggerBoxes: [{ x: 60, y: 95, w: 30, h: 10 }],
        textExtent: { minX: 40, maxX: 150 },
      },
      // A page the PDF does not have is skipped, not an error.
      {
        kind: 'cue',
        id: 'b',
        pageIndex: 9,
        x: 0,
        y: 0,
        type: 'go',
        lead: 'LX',
        typeWord: '',
        number: '1',
        numberInk: '#1A1715',
        colour: '#F5A623',
        side: 'left',
        sortKey: { department: 0, major: 1, minor: 0 },
        triggerBoxes: [],
        textExtent: null,
      },
    ],
    footer,
  )
  const doc = await PDFDocument.load(out)
  expect(doc.getPageCount()).toBe(2)
  const [p0, p1] = doc.getPages()
  expect(p0?.getMediaBox()).toEqual({ x: 0, y: 0, width: 300, height: 400 })
  expect(p0?.getCropBox()).toEqual({ x: 20, y: 30, width: 200, height: 300 })
  expect(p1?.getRotation().angle).toBe(270)
  expect(p1?.getSize()).toEqual({ width: 500, height: 200 })
})

const numbers = (doc: PDFDocument, ns: number[]) => doc.context.obj(ns)

describe('frameOf', () => {
  test.each([
    [-90, 270],
    [450, 90],
    [-180, 180],
    [360, 0],
    [90, 90],
  ])('/Rotate %i is read as %i', async (given, want) => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 400])
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(given))
    expect(frameOf(page).rotation).toBe(want)
  })

  test('/Rotate inherited from the page tree applies', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 400])
    doc.catalog.Pages().set(PDFName.of('Rotate'), PDFNumber.of(90))
    expect(page.node.has(PDFName.of('Rotate'))).toBe(false)
    expect(frameOf(page).rotation).toBe(90)
  })

  test('a crop box larger than the media box is clipped to it', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 400])
    page.setCropBox(-20, -30, 400, 600)
    expect(frameOf(page)).toEqual({ bx: 0, by: 0, w: 300, h: 400, rotation: 0 })
  })

  test('a crop box inside an offset media box keeps its own corner', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 400])
    page.setMediaBox(50, 50, 300, 400)
    page.setCropBox(70, 80, 100, 150)
    expect(frameOf(page)).toEqual({ bx: 70, by: 80, w: 100, h: 150, rotation: 0 })
  })

  test('a reversed box (upper-right corner first) is normalised', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 400])
    page.node.set(PDFName.of('MediaBox'), numbers(doc, [350, 450, 50, 50]))
    page.node.set(PDFName.of('CropBox'), numbers(doc, [250, 350, 100, 100]))
    expect(frameOf(page)).toEqual({ bx: 100, by: 100, w: 150, h: 250, rotation: 0 })
    page.node.delete(PDFName.of('CropBox'))
    expect(frameOf(page)).toEqual({ bx: 50, by: 50, w: 300, h: 400, rotation: 0 })
  })
})

async function stampedContent(items: Parameters<typeof stampScript>[1]): Promise<string> {
  const src = await PDFDocument.create()
  src.addPage([400, 400])
  const out = await stampScript(await src.save(), items, footer)
  const c = ((await pdfContent(out))[0] as string).replace(/\r/g, '')
  return c
}

const cueItem = (number: string): Extract<StampItem, { kind: 'cue' }> => ({
  kind: 'cue',
  id: 'n',
  pageIndex: 0,
  x: 40,
  y: 200,
  type: 'go',
  lead: 'LX',
  typeWord: '',
  number,
  numberInk: '#1A1715',
  colour: '#F5A623',
  side: 'left',
  sortKey: { department: 0, major: 1, minor: 0 },
  triggerBoxes: [],
  textExtent: null,
})

const annotationItem = (type: 'note' | 'stamp', text: string): StampItem => ({
  kind: 'annotation',
  pageIndex: 0,
  x: 200,
  y: 200,
  type,
  geometry: {},
  text,
  colour: '#2563EB',
  strokeWidth: 1.5,
  fontSize: type === 'stamp' ? 12 : 10,
  wordBoxes: [],
})

test('B05 the entire tag label prints in page ink with Helvetica metrics', async () => {
  const content = await stampedContent([cueItem('77')])
  // The colour set (rg) before the number's Tj, and before the lead's.
  const colourBefore = (hexText: string) => {
    const at = content.indexOf(`<${hexText}>`)
    const before = content.slice(0, at)
    const m = [...before.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].at(-1) as RegExpMatchArray
    return [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255))
  }
  expect(colourBefore('3737')).toEqual([0x1a, 0x17, 0x15])
  expect(colourBefore('4C58')).toEqual([0x1a, 0x17, 0x15])
  expect(content).toMatch(/\/Helvetica[-\d]* 9 Tf/)
  expect(content).toMatch(/\/Helvetica-Bold[-\d]* 9 Tf/)
})

test('a printed note is a tinted block with a left bar and no outline, text in page ink', async () => {
  const content = await stampedContent([annotationItem('note', 'ride the pad')])
  // Two filled rectangles (tint, bar); no stroked or fill-and-stroke operator.
  expect(content.match(/\nh\nf\n/g)?.length).toBe(2)
  expect(content).not.toMatch(/\n(S|B|b|s)\n/)
  const rgs = [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map((m) =>
    [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255)),
  )
  // Tint: 12 % of #2563EB into white; bar: the colour itself; text: the page ink.
  expect(rgs).toContainEqual([
    255 - Math.round((255 - 0x25) * 0.12),
    255 - Math.round((255 - 0x63) * 0.12),
    255 - Math.round((255 - 0xeb) * 0.12),
  ])
  expect(rgs).toContainEqual([0x25, 0x63, 0xeb])
  expect(rgs).toContainEqual([0x1a, 0x17, 0x15])
})

test('a printed stamp is turned 3 degrees, in bold, with letter spacing', async () => {
  const content = await stampedContent([annotationItem('stamp', 'FAST PACE')])
  // The box's matrix (cm) and the text's (Tm) both carry the 3 degree turn.
  const turned = (op: string) =>
    [
      ...content.matchAll(
        new RegExp(`([-\\d.]+) ([-\\d.]+) ([-\\d.]+) ([-\\d.]+) [-\\d.]+ [-\\d.]+ ${op}`, 'g'),
      ),
    ].some(
      (m) =>
        Math.abs(Number(m[1]) - Math.cos(Math.PI / 60)) < 1e-4 &&
        Math.abs(Number(m[2]) - Math.sin(Math.PI / 60)) < 1e-4,
    )
  expect(turned('cm')).toBe(true)
  expect(turned('Tm')).toBe(true)
  // Letter spacing .06em of 12 pt, in the bold face.
  expect(content).toMatch(/0\.72 Tc/)
  expect(content).toMatch(/\/Helvetica-Bold[-\d]* 12 Tf/)
})

/** `[x, y]` of every drawn string, from the Tm before its Tj, page content in drawing order. */
function drawnText(content: string): Array<{ text: string; x: number; y: number; size: number }> {
  const out: Array<{ text: string; x: number; y: number; size: number }> = []
  let size = 0
  for (const m of content.matchAll(
    /\/\S+ ([\d.]+) Tf|[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+) Tm|<([0-9A-Fa-f\s]*)>\s*Tj/g,
  )) {
    if (m[1]) size = Number(m[1])
    else if (m[2]) out.push({ text: '', x: Number(m[2]), y: Number(m[3]), size })
    else if (m[4] !== undefined)
      (out.at(-1) as { text: string }).text = Buffer.from(m[4].replace(/\s+/g, ''), 'hex').toString(
        'latin1',
      )
  }
  return out
}

const noteItem = (cueId: string, text: string): StampItem => ({
  kind: 'cue-note',
  cueId,
  pageIndex: 0,
  text,
  colour: '#F5A623',
})

describe('cue notes', () => {
  const stampedText = async (items: StampItem[]) => drawnText(await stampedContent(items))
  const withId = (id: string, y: number, over: Partial<Extract<StampItem, { kind: 'cue' }>> = {}) =>
    ({ ...cueItem('1'), id, y, ...over }) as StampItem
  const at = (drawn: Awaited<ReturnType<typeof stampedText>>, text: string) =>
    drawn.find((d) => d.text === text)

  test('a note prints under its tag in 7 pt Helvetica in the department colour', async () => {
    const content = await stampedContent([withId('a', 200), noteItem('a', 'Ride the pad')])
    const drawn = drawnText(content)
    const number = at(drawn, '1')
    const note = at(drawn, 'Ride the pad')
    if (!number || !note) throw new Error('missing text')
    expect(note.size).toBe(7)
    // Level with the tag's left edge (4 pt in), and below its number.
    expect(note.x).toBeCloseTo(4)
    expect(note.y).toBeLessThan(number.y - 7)
    expect(note.y).toBeGreaterThan(200 - 7 - 9)
    // The colour set before the note's Tj is the department's amber.
    const before = content.slice(
      0,
      content.indexOf(`<${Buffer.from('Ride the pad').toString('hex')}`),
    )
    const m = [...before.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].at(-1) as RegExpMatchArray
    expect([m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255))).toEqual([0xf5, 0xa6, 0x23])
  })

  test('two stacked tags with notes do not overlap', async () => {
    const drawn = await stampedText([
      withId('a', 200, { number: '10' }),
      noteItem('a', 'first note'),
      withId('b', 200, { number: '11', sortKey: { department: 0, major: 11, minor: 0 } }),
      noteItem('b', 'second note'),
    ])
    const [first, number2, note1, note2] = [
      at(drawn, '10'),
      at(drawn, '11'),
      at(drawn, 'first note'),
      at(drawn, 'second note'),
    ]
    if (!first || !number2 || !note1 || !note2) throw new Error('missing text')
    // The second tag's top (its number's centre + 7) is below the first note's block (bottom
    // = first tag's bottom - 9); the notes are 23 pt apart, one block each.
    expect(note1.y - note2.y).toBeCloseTo(14 + 9 + 2)
    expect(first.y - number2.y).toBeCloseTo(14 + 9 + 2)
    expect(note1.y).toBeGreaterThan(number2.y + 7)
  })

  test('a 36 pt margin draws no note', async () => {
    const narrow = { textExtent: { minX: 36, maxX: 300 } }
    const drawn = await stampedText([withId('a', 200, narrow), noteItem('a', 'Ride the pad')])
    expect(at(drawn, 'Ride the pad')).toBeUndefined()
    expect(at(drawn, '1')).toBeDefined()
  })

  test('a note with no cue item, or on a page the PDF lacks, draws nothing', async () => {
    const drawn = await stampedText([
      noteItem('missing', 'orphan'),
      { ...noteItem('a', 'far'), pageIndex: 9 },
      withId('a', 200),
    ])
    expect(drawn.map((d) => d.text)).not.toContain('orphan')
    expect(drawn.map((d) => d.text)).not.toContain('far')
  })

  test('no note items, as when cue notes are off, draws no note', async () => {
    const drawn = await stampedText([withId('a', 200)])
    expect(drawn.filter((d) => d.size === 7).map((d) => d.text)).toEqual([
      expect.stringContaining('Pirates'),
    ])
  })
})

describe('page subset', () => {
  const tag = (pageIndex: number, number: string): StampItem => ({
    ...cueItem(number),
    id: `c${pageIndex}`,
    pageIndex,
    y: 200,
  })
  const fourPages = async () => {
    const src = await PDFDocument.create()
    for (const size of [
      [300, 400],
      [400, 300],
      [500, 500],
      [250, 350],
    ] as Array<[number, number]>)
      src.addPage(size)
    src.getPage(1).setRotation(degrees(90))
    return src.save()
  }

  test('pages [1, 2] outputs exactly 2 pages, each with its footer, stamped tags on the right pages', async () => {
    const out = await stampScript(
      await fourPages(),
      [tag(0, '10'), tag(1, '11'), tag(2, '12'), tag(3, '13')],
      footer,
      { pages: [1, 2] },
    )
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
    // The kept pages keep their own sizes and rotation.
    expect(doc.getPage(0).getSize()).toEqual({ width: 400, height: 300 })
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(1).getSize()).toEqual({ width: 500, height: 500 })
    const texts = await pdfTexts(out)
    const line = 'Pirates · Libretto v2 · LX · Binder v3 · 2026-10-15 14:02'
    expect(texts).toEqual([
      expect.arrayContaining(['LX', '11', line.replace('·', '·')]),
      expect.arrayContaining(['LX', '12', line.replace('·', '·')]),
    ])
    expect(texts[0]).not.toContain('10')
    expect(texts[0]).not.toContain('12')
    expect(texts[1]).not.toContain('13')
  })

  test('pages come out in page order and are de-duplicated', async () => {
    const out = await stampScript(await fourPages(), [], footer, { pages: [3, 0, 3] })
    const doc = await PDFDocument.load(out)
    expect(doc.getPages().map((p) => p.getSize().width)).toEqual([300, 250])
  })

  test('a subset keeps a rotation the page inherits from the page tree', async () => {
    const src = await PDFDocument.create()
    src.addPage([300, 400])
    src.addPage([300, 400])
    src.catalog.Pages().set(PDFName.of('Rotate'), PDFNumber.of(90))
    const out = await stampScript(await src.save(), [], footer, { pages: [1] })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
    expect(frameOf(doc.getPage(0)).rotation).toBe(90)
  })

  test('a page outside the script, or an empty list, is an error', async () => {
    await expect(stampScript(await fourPages(), [], footer, { pages: [4] })).rejects.toThrow(
      /page/i,
    )
    await expect(stampScript(await fourPages(), [], footer, { pages: [] })).rejects.toThrow(/page/i)
  })

  test('leaving pages out drops the dead objects: the subset is smaller than the whole', async () => {
    const src = await PDFDocument.create()
    for (let i = 0; i < 30; i++) src.addPage([300, 400]).drawText(`page ${i} ${'x'.repeat(400)}`)
    const bytes = await src.save()
    const all = await stampScript(bytes, [], footer)
    const some = await stampScript(bytes, [], footer, { pages: [0, 1] })
    expect(some.byteLength).toBeLessThan(all.byteLength / 4)
  })
})

describe('paper fit', () => {
  const A4 = { w: 595.28, h: 841.89 }
  const LETTER = { w: 612, h: 792 }

  const single = async (size: [number, number], rotation = 0) => {
    const src = await PDFDocument.create()
    const page = src.addPage(size)
    page.setRotation(degrees(rotation))
    return src.save()
  }
  /** The matrix the page's first `Do` is drawn under: every `cm` before it, composed. */
  const placed = async (pdf: Uint8Array) => {
    const content = ((await pdfContent(pdf))[0] as string).replace(/\r/g, '')
    const before = content.slice(0, content.indexOf(' Do'))
    let m = [1, 0, 0, 1, 0, 0]
    for (const c of before.matchAll(
      /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/g,
    )) {
      const [a, b, cc, d, e, f] = c.slice(1, 7).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ]
      const [A, B, C, D, E, F] = m as [number, number, number, number, number, number]
      // CTM' = new x CTM, in the row-vector convention PDF uses.
      m = [
        a * A + b * C,
        a * B + b * D,
        cc * A + d * C,
        cc * B + d * D,
        e * A + f * C + E,
        e * B + f * D + F,
      ]
    }
    return m
  }

  test('paper Letter on an A4 page yields a 612×792 media box with content scaled inside', async () => {
    const out = await stampScript(await single([A4.w, A4.h]), [], footer, { paper: 'Letter' })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 })
    expect(doc.getPage(0).getRotation().angle).toBe(0)
    // Height is the tight side: 792 / 841.89; the page is centred across.
    const scale = 792 / A4.h
    const [a, , , d, e, f] = await placed(out)
    expect(a).toBeCloseTo(scale, 4)
    expect(d).toBeCloseTo(scale, 4)
    expect(e).toBeCloseTo((612 - A4.w * scale) / 2, 2)
    expect(f).toBeCloseTo(0, 2)
  })

  test('paper A4 on a Letter page fits the width and centres vertically', async () => {
    const out = await stampScript(await single([LETTER.w, LETTER.h]), [], footer, { paper: 'A4' })
    const doc = await PDFDocument.load(out)
    const box = doc.getPage(0).getMediaBox()
    expect([box.width, box.height].map((v) => Math.round(v * 100) / 100)).toEqual([A4.w, A4.h])
    const scale = A4.w / LETTER.w
    const [a, , , d, e, f] = await placed(out)
    expect(a).toBeCloseTo(scale, 4)
    expect(d).toBeCloseTo(scale, 4)
    expect(e).toBeCloseTo(0, 2)
    expect(f).toBeCloseTo((A4.h - LETTER.h * scale) / 2, 2)
  })

  test('a landscape page fits a landscape sheet: the paper swaps per page', async () => {
    const out = await stampScript(await single([A4.h, A4.w]), [], footer, { paper: 'Letter' })
    const doc = await PDFDocument.load(out)
    expect(doc.getPage(0).getMediaBox()).toMatchObject({ width: 792, height: 612 })
  })

  test('a rotated page lands upright: a 90 degree page fits by its displayed size', async () => {
    // Unrotated 595x842 with /Rotate 90 displays 842 wide, 595 tall: landscape.
    const out = await stampScript(await single([A4.w, A4.h], 90), [], footer, { paper: 'Letter' })
    const doc = await PDFDocument.load(out)
    expect(doc.getPage(0).getMediaBox()).toMatchObject({ width: 792, height: 612 })
    expect(doc.getPage(0).getRotation().angle).toBe(0)
  })

  test('a page already within 3% of the paper is not resized', async () => {
    // 1 % under A4 each way; and exactly Letter for paper Letter.
    const cases: Array<[[number, number], 'A4' | 'Letter']> = [
      [[A4.w * 0.99, A4.h * 1.01], 'A4'],
      [[LETTER.w, LETTER.h], 'Letter'],
      [[A4.h * 1.02, A4.w], 'A4'],
    ]
    for (const [size, paper] of cases) {
      const out = await stampScript(await single(size), [], footer, { paper })
      const doc = await PDFDocument.load(out)
      const box = doc.getPage(0).getMediaBox()
      expect([box.width, box.height]).toEqual(size)
      expect(((await pdfContent(out))[0] as string).includes(' Do')).toBe(false)
    }
    // 5 % off is resized.
    const off = await stampScript(await single([LETTER.w, LETTER.h]), [], footer, { paper: 'A4' })
    expect(((await pdfContent(off))[0] as string).includes(' Do')).toBe(true)
  })

  test('only the pages that need it are resized; the stamps and footer scale with the page', async () => {
    const src = await PDFDocument.create()
    src.addPage([LETTER.w, LETTER.h])
    src.addPage([A4.w, A4.h])
    const out = await stampScript(
      await src.save(),
      [
        { ...cueItem('5'), pageIndex: 0 },
        { ...cueItem('6'), pageIndex: 1 },
      ],
      footer,
      { paper: 'Letter' },
    )
    const doc = await PDFDocument.load(out)
    // Letter -> Letter: untouched (cue and footer drawn straight on it); A4 -> Letter: embedded.
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
    expect(doc.getPage(1).getMediaBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 })
    const [c0, c1] = await pdfContent(out)
    expect(c0).not.toContain(' Do')
    expect(c1).toContain(' Do')
    expect((await pdfTexts(out))[0]).toContain('5')
  })

  test('paper and a page subset together fit only the pages kept', async () => {
    const src = await PDFDocument.create()
    src.addPage([A4.w, A4.h])
    src.addPage([A4.w, A4.h])
    src.addPage([A4.w, A4.h])
    const out = await stampScript(await src.save(), [], footer, { pages: [2], paper: 'Letter' })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getMediaBox()).toMatchObject({ width: 612, height: 792 })
  })
})
