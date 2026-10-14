import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { newDoc, rasterisePages, sizeOf, textToPdf } from './lib.ts'
import { FIXTURES, GENERATED_DIR } from './paths.ts'

/**
 * page 1 A4 portrait text; page 2 A4 with /Rotate 90, "ROTATED" appearing top-left once the
 * rotation is applied; page 3 Letter text; page 4 the rasterised scan of libretto page 1.
 */
export async function makeMixedPdf(): Promise<Uint8Array> {
  const doc = await newDoc()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const draw = (size: [number, number], text: string) => {
    const page = doc.addPage(size)
    page.drawText(text, { x: 72, y: size[1] - 100, size: 24, font })
    return page
  }
  draw(sizeOf('A4'), 'PAGE ONE PORTRAIT')

  // /Rotate 90 turns the page clockwise: unrotated bottom-left becomes displayed top-left and
  // unrotated +y becomes displayed +x. Text drawn rotated 90 degrees counter-clockwise from the
  // unrotated bottom-left therefore reads left-to-right, upright, at the displayed top-left.
  const rotated = doc.addPage(sizeOf('A4'))
  rotated.setRotation(degrees(90))
  rotated.drawText('ROTATED', { x: 60, y: 40, size: 24, font, rotate: degrees(90) })

  draw(sizeOf('Letter'), 'PAGE THREE LETTER')

  const scan = await PDFDocument.load(await rasterisePages(FIXTURES.librettoPdf, [1], 150))
  const [p4] = await doc.copyPages(scan, [0])
  doc.addPage(p4)
  return doc.save()
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function generate(): Promise<void> {
  await mkdir(GENERATED_DIR, { recursive: true })
  const text = await readFile(FIXTURES.librettoText, 'utf8')
  await writeFile(
    FIXTURES.librettoPdf,
    await textToPdf(text, { pageSize: 'A4', fontSize: 11, linesPerPage: 48 }),
  )
  await writeFile(
    FIXTURES.scanPdf,
    await rasterisePages(FIXTURES.librettoPdf, [1, 2, 3, 4, 5, 6, 7, 8], 150),
  )
  await writeFile(FIXTURES.mixedPdf, await makeMixedPdf())
}

/** Generates the fixtures when any is missing. Output is deterministic in content. */
export async function ensureFixtures(): Promise<typeof FIXTURES> {
  const present = await Promise.all(
    [FIXTURES.librettoPdf, FIXTURES.scanPdf, FIXTURES.mixedPdf].map(exists),
  )
  if (!present.every(Boolean)) await generate()
  return FIXTURES
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await generate()
  console.log(`fixtures written to ${GENERATED_DIR}`)
}
