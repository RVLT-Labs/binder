import { type PaperSize, paperSize } from '@binder/shared'

function parse(settings: string | null | undefined): Record<string, unknown> {
  try {
    const value = settings ? JSON.parse(settings) : {}
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/** The paper cue sheets are laid out for, from a show's `settings` JSON text: A4 unless it says Letter. */
export function readPaperSize(settings: string | null | undefined): PaperSize {
  return paperSize(parse(settings))
}

/** The show's `settings` JSON text with its paper size replaced; every other setting is kept. */
export function withPaperSize(settings: string | null | undefined, size: PaperSize): string {
  return JSON.stringify({ ...parse(settings), paperSize: size })
}

/** The sheets in points, portrait: the same sizes the stamping fit uses (`PAPER_POINTS` in core). */
const SHEETS: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
}
/** A page this close to a sheet (each side) already is that sheet: the fit leaves it alone. */
const SAME_SHEET = 0.03

/**
 * The paper a page of this displayed size (points) already is, within 3% on each side and either
 * way up, or `null` when it is neither: what the dialog starts the paper at, so an untouched
 * print changes nothing.
 */
export function nearestPaper(
  width: number | null | undefined,
  height: number | null | undefined,
): PaperSize | null {
  if (!width || !height || width <= 0 || height <= 0) return null
  const [short, long] = width <= height ? [width, height] : [height, width]
  let best: { paper: PaperSize; error: number } | null = null
  for (const paper of ['A4', 'Letter'] as const) {
    const sheet = SHEETS[paper]
    const wide = Math.abs(short / sheet.width - 1)
    const tall = Math.abs(long / sheet.height - 1)
    if (wide <= SAME_SHEET && tall <= SAME_SHEET) {
      const error = wide + tall
      if (!best || error < best.error) best = { paper, error }
    }
  }
  return best?.paper ?? null
}
