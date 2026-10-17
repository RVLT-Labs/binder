import { runTool } from './exec'

const POPPLER_TIMEOUT_MS = 2 * 60 * 1000

const poppler = (
  command: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
) =>
  runTool(command, args, { timeoutMs: opts.timeoutMs ?? POPPLER_TIMEOUT_MS, signal: opts.signal })

/** pdfinfo ran cleanly but its output lacks what we need: a deterministic, unreadable PDF. */
export class PdfInfoParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfInfoParseError'
  }
}

export interface PdfPageInfo {
  /** Displayed width in points, after /Rotate. */
  width: number
  /** Displayed height in points, after /Rotate. */
  height: number
  rotation: number
}

export interface PdfInfo {
  pageCount: number
  pages: PdfPageInfo[]
}

/** Page count and per-page displayed dimensions (spec 4.3) from `pdfinfo`. */
export async function pdfInfo(path: string): Promise<PdfInfo> {
  const summary = await poppler('pdfinfo', [path])
  const pageCount = Number(summary.stdout.match(/^Pages:\s+(\d+)/m)?.[1])
  if (!Number.isInteger(pageCount)) throw new PdfInfoParseError('pdfinfo gave no page count')
  if (pageCount === 0) return { pageCount, pages: [] }

  const { stdout } = await poppler('pdfinfo', ['-f', '1', '-l', String(pageCount), path])
  const sizes = new Map<number, [number, number]>()
  const rotations = new Map<number, number>()
  for (const m of stdout.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)) {
    sizes.set(Number(m[1]), [Number(m[2]), Number(m[3])])
  }
  for (const m of stdout.matchAll(/^Page\s+(\d+) rot:\s+(\d+)/gm)) {
    rotations.set(Number(m[1]), Number(m[2]))
  }
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const size = sizes.get(i + 1)
    const rotation = rotations.get(i + 1)
    if (!size || rotation === undefined)
      throw new PdfInfoParseError(`pdfinfo gave no size for page ${i + 1}`)
    const [w, h] = size
    const quarterTurn = rotation % 180 === 90
    return { width: quarterTurn ? h : w, height: quarterTurn ? w : h, rotation }
  })
  return { pageCount, pages }
}

export interface ImageStats {
  /** Zero-based indices of the pages that draw at least one raster image. */
  pages: Set<number>
  /**
   * The median over all images of min(x-ppi, y-ppi), the effective scan resolution; null when the
   * listing has no usable resolution (no images, or columns this poppler does not print).
   */
  medianPpi: number | null
}

/**
 * Which pages carry raster images and at what resolution (`pdfimages -list`). Its columns are
 * `page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio`; the
 * object and ID are two fields, so x-ppi and y-ppi are fields 12 and 13 (zero-based).
 */
export async function imageStats(pdf: string): Promise<ImageStats> {
  const { stdout } = await poppler('pdfimages', ['-list', pdf])
  const pages = new Set<number>()
  const ppis: number[] = []
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (!/^\d+$/.test(fields[0] ?? '') || !/^\d+$/.test(fields[1] ?? '')) continue
    pages.add(Number(fields[0]) - 1)
    const ppi = Math.min(Number(fields[12]), Number(fields[13]))
    if (Number.isFinite(ppi) && ppi > 0) ppis.push(ppi)
  }
  ppis.sort((a, b) => a - b)
  const mid = Math.floor(ppis.length / 2)
  const medianPpi =
    ppis.length === 0
      ? null
      : ppis.length % 2 === 1
        ? (ppis[mid] as number)
        : ((ppis[mid - 1] as number) + (ppis[mid] as number)) / 2
  return { pages, medianPpi }
}

/** The number of non-whitespace characters in the PDF's text layer, over every page (`pdftotext`). */
export async function countTextChars(
  pdf: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<number> {
  const { stdout } = await poppler('pdftotext', ['-enc', 'UTF-8', pdf, '-'], opts)
  return stdout.replace(/\s/g, '').length
}

/**
 * How many content-stream syntax errors poppler reports reading every page's text (`Syntax Error`
 * lines on stderr); 0 for a clean PDF. Poppler carries on past them, so the text it can read is
 * what the user gets, and a page that loses text after OCR shows up here. The text itself goes to
 * /dev/null, so only stderr is buffered.
 */
export async function contentSyntaxErrors(
  pdf: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<number> {
  const { stderr } = await poppler('pdftotext', [pdf, '/dev/null'], opts)
  return (stderr.match(/^Syntax Error/gm) ?? []).length
}

const pageArgs = (pageIndex: number) => ['-f', String(pageIndex + 1), '-l', String(pageIndex + 1)]

/**
 * Renders a zero-based page as a PNG 160 px wide in displayed orientation; returns the PNG's path.
 * pdftoppm applies -scale-to-x/-y to the unrotated axes, so a quarter-turned page (`rotation` 90 or
 * 270, as `pdfInfo` reports it) fixes its unrotated height instead.
 */
export async function renderThumbnail(
  pdf: string,
  pageIndex: number,
  outPrefix: string,
  rotation: number,
): Promise<string> {
  const [x, y] = rotation % 180 === 90 ? ['-1', '160'] : ['160', '-1']
  await poppler('pdftoppm', [
    '-png',
    ...pageArgs(pageIndex),
    '-scale-to-x',
    x,
    '-scale-to-y',
    y,
    '-singlefile',
    pdf,
    outPrefix,
  ])
  return `${outPrefix}.png`
}

/** Renders a zero-based page as a JPEG at most `maxPx` on its long side; returns the JPEG's path. */
export async function renderPageImage(
  pdf: string,
  pageIndex: number,
  outPrefix: string,
  maxPx = 1600,
): Promise<string> {
  await poppler('pdftoppm', [
    '-jpeg',
    ...pageArgs(pageIndex),
    '-scale-to',
    String(maxPx),
    '-singlefile',
    pdf,
    outPrefix,
  ])
  return `${outPrefix}.jpg`
}

/** `pdftotext -bbox-layout` XHTML for one zero-based page (parse with `fromPopplerBbox`). */
export async function extractBboxXhtml(pdf: string, pageIndex: number): Promise<string> {
  const { stdout } = await poppler('pdftotext', ['-bbox-layout', ...pageArgs(pageIndex), pdf, '-'])
  return stdout
}
