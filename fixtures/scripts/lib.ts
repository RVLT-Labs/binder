import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PageSizes, PDFDocument, StandardFonts } from 'pdf-lib'

const run = promisify(execFile)
const FIXED_DATE = new Date('2026-01-01T00:00:00Z')

export type PageSizeName = 'A4' | 'Letter'
export interface TextToPdfOptions {
  pageSize: PageSizeName
  fontSize: number
  linesPerPage: number
}

export function sizeOf(name: PageSizeName): [number, number] {
  return name === 'A4' ? [...PageSizes.A4] : [...PageSizes.Letter]
}

/** Helvetica is WinAnsi only: map common typography to ASCII and drop anything else. */
export function toWinAnsi(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\t/g, '    ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
}

export function newDoc(): Promise<PDFDocument> {
  return PDFDocument.create({ updateMetadata: false }).then((d) => {
    d.setCreationDate(FIXED_DATE)
    d.setModificationDate(FIXED_DATE)
    return d
  })
}

/** Lay text out as monospace-ish lines of Helvetica, wrapping long lines, `linesPerPage` per page. */
export async function textToPdf(text: string, opts: TextToPdfOptions): Promise<Uint8Array> {
  const doc = await newDoc()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const [w, h] = sizeOf(opts.pageSize)
  const margin = 50
  const maxWidth = w - 2 * margin
  const leading = (h - 2 * margin) / opts.linesPerPage

  const lines: string[] = []
  for (const raw of toWinAnsi(text).split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (font.widthOfTextAtSize(line, opts.fontSize) <= maxWidth) {
      lines.push(line)
      continue
    }
    const indent = line.match(/^ */)?.[0] ?? ''
    let cur = ''
    for (const word of line.trim().split(/ +/)) {
      const next = cur ? `${cur} ${word}` : indent + word
      if (cur && font.widthOfTextAtSize(next, opts.fontSize) > maxWidth) {
        lines.push(cur)
        cur = indent + word
      } else cur = next
    }
    lines.push(cur)
  }

  for (let i = 0; i < lines.length; i += opts.linesPerPage) {
    const page = doc.addPage([w, h])
    lines.slice(i, i + opts.linesPerPage).forEach((l, j) => {
      if (l)
        page.drawText(l, {
          x: margin,
          y: h - margin - (j + 1) * leading + (leading - opts.fontSize),
          size: opts.fontSize,
          font,
        })
    })
  }
  return doc.save()
}

/** Rasterise 1-based `pages` of a PDF to PNG (pdftoppm) and embed each in an image-only PDF at the original page size. */
export async function rasterisePages(
  pdfPath: string,
  pages: number[],
  dpi: number,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(await readFile(pdfPath), { updateMetadata: false })
  const out = await newDoc()
  const dir = await mkdtemp(join(tmpdir(), 'binder-raster-'))
  try {
    for (const p of pages) {
      const prefix = join(dir, `p${p}`)
      await run('pdftoppm', [
        '-png',
        '-r',
        String(dpi),
        '-f',
        String(p),
        '-l',
        String(p),
        '-singlefile',
        pdfPath,
        prefix,
      ])
      const png = await out.embedPng(await readFile(`${prefix}.png`))
      const { width, height } = src.getPage(p - 1).getSize()
      out.addPage([width, height]).drawImage(png, { x: 0, y: 0, width, height })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  return out.save()
}

export async function pageCount(pdf: string): Promise<number> {
  const { stdout } = await run('pdfinfo', [pdf])
  const m = stdout.match(/^Pages:\s+(\d+)/m)
  if (!m?.[1]) throw new Error(`pdfinfo gave no page count for ${pdf}`)
  return Number(m[1])
}

/** True when pdftotext extracts any word from the 1-based page. */
export async function hasText(pdf: string, page: number): Promise<boolean> {
  const { stdout } = await run('pdftotext', ['-f', String(page), '-l', String(page), pdf, '-'])
  return stdout.trim().length > 0
}
