import { runTool } from './exec'

const POPPLER_TIMEOUT_MS = 2 * 60 * 1000

const poppler = (command: string, args: string[]) =>
  runTool(command, args, { timeoutMs: POPPLER_TIMEOUT_MS })

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
  if (!Number.isInteger(pageCount)) throw new Error(`pdfinfo gave no page count for ${path}`)
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
    if (!size || rotation === undefined) throw new Error(`pdfinfo gave no size for page ${i + 1}`)
    const [w, h] = size
    const quarterTurn = rotation % 180 === 90
    return { width: quarterTurn ? h : w, height: quarterTurn ? w : h, rotation }
  })
  return { pageCount, pages }
}

/** Zero-based indices of the pages that draw at least one raster image (`pdfimages -list`). */
export async function listImagePages(pdf: string): Promise<Set<number>> {
  const { stdout } = await poppler('pdfimages', ['-list', pdf])
  const pages = new Set<number>()
  for (const m of stdout.matchAll(/^\s*(\d+)\s+\d+\s+\S+/gm)) pages.add(Number(m[1]) - 1)
  return pages
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
