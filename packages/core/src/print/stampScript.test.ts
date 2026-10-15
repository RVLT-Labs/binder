import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
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
        code: 'LX',
        number: '10',
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
        code: 'LX',
        number: '1',
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
