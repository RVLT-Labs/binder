import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

/** The first `count` pages of a PDF, as a new PDF. */
export async function firstPages(pdfPath: string, count: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(await readFile(pdfPath), { updateMetadata: false })
  const doc = await newDoc()
  for (const page of await doc.copyPages(src, [...Array(count).keys()])) doc.addPage(page)
  return doc.save()
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/** Writes to a temp name beside the target, then renames: rename is the only publication step. */
async function publish(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

async function generate(): Promise<void> {
  await mkdir(GENERATED_DIR, { recursive: true })
  const text = await readFile(FIXTURES.librettoText, 'utf8')
  // The libretto first: the scan and mixed PDFs are rasterised from it.
  await publish(
    FIXTURES.librettoPdf,
    await textToPdf(text, { pageSize: 'A4', fontSize: 11, linesPerPage: 48 }),
  )
  await publish(
    FIXTURES.scanPdf,
    await rasterisePages(FIXTURES.librettoPdf, [1, 2, 3, 4, 5, 6, 7, 8], 150),
  )
  await publish(FIXTURES.mixedPdf, await makeMixedPdf())
  await publish(FIXTURES.librettoShortPdf, await firstPages(FIXTURES.librettoPdf, 3))
}

let inflight: Promise<typeof FIXTURES> | undefined

/**
 * Generates the fixtures when any is missing. Output is deterministic in content. Files are
 * published by atomic rename, and concurrent calls in one process share one run.
 */
export function ensureFixtures(): Promise<typeof FIXTURES> {
  inflight ??= (async () => {
    const present = await Promise.all(
      [FIXTURES.librettoPdf, FIXTURES.scanPdf, FIXTURES.mixedPdf, FIXTURES.librettoShortPdf].map(
        exists,
      ),
    )
    if (!present.every(Boolean)) await generate()
    return FIXTURES
  })()
  return inflight
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await generate()
  console.log(`fixtures written to ${GENERATED_DIR}`)
}
