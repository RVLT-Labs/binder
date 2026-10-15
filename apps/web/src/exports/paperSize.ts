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
