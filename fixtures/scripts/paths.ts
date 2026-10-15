import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const PUBLIC_DIR = join(here, '..', 'public')
export const GENERATED_DIR = join(PUBLIC_DIR, 'generated')
export const PIRATES_TXT = join(PUBLIC_DIR, 'pirates.txt')

/** Absolute paths of the generated fixtures. Run `ensureFixtures()` before reading them. */
export const FIXTURES = {
  librettoText: PIRATES_TXT,
  librettoPdf: join(GENERATED_DIR, 'pirates-libretto.pdf'),
  /** The libretto's first three pages: a text PDF that processes in seconds, for markup e2e. */
  librettoShortPdf: join(GENERATED_DIR, 'pirates-short.pdf'),
  scanPdf: join(GENERATED_DIR, 'pirates-scan.pdf'),
  mixedPdf: join(GENERATED_DIR, 'mixed.pdf'),
  /** One A4 page whose media and crop boxes start at (50, 50), with OFFSET at the visible top-left. */
  offsetPdf: join(GENERATED_DIR, 'offset.pdf'),
}
