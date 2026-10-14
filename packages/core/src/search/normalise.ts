const MARKS = /\p{M}/gu
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

/** Lowercase, strip diacritics and edge punctuation; inner apostrophes and hyphens stay. */
export function normaliseToken(s: string): string {
  return s.normalize('NFKD').replace(MARKS, '').toLowerCase().replace(/’/g, "'").replace(EDGE, '')
}
