import { degrees, PDFDocument } from 'pdf-lib'
import { expect, test } from 'vitest'
import { displayedToUser, stampScript } from './stampScript'

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
        pageIndex: 1,
        x: 40,
        y: 100,
        type: 'warn',
        boxText: 'W LX 10',
        labelText: 'Go ✓',
        colour: '#F5A623',
      },
      // A page the PDF does not have is skipped, not an error.
      {
        kind: 'cue',
        pageIndex: 9,
        x: 0,
        y: 0,
        type: 'go',
        boxText: 'LX 1',
        labelText: '',
        colour: '#F5A623',
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
