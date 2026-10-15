import { invalid } from '../errors'

const SEGMENT = /^[A-Za-z0-9._-]+$/

/** Keys are `/`-joined segments of [A-Za-z0-9._-], rooted at `shows/`, with no `.` or `..` segment. */
export function validateBlobKey(key: string): string {
  const segments = key.split('/')
  const ok =
    segments.length >= 2 &&
    segments[0] === 'shows' &&
    segments.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..')
  if (!ok) throw invalid('Invalid blob key')
  return key
}

export function showIdFromKey(key: string): string | null {
  const segments = key.split('/')
  if (segments[0] !== 'shows' || !segments[1]) return null
  return segments[1]
}

const versionPrefix = (showId: string, documentId: string, versionId: string) =>
  `shows/${showId}/documents/${documentId}/versions/${versionId}`

export function originalBlobKey(showId: string, documentId: string, versionId: string): string {
  return `${versionPrefix(showId, documentId, versionId)}/original.pdf`
}

/** The working PDF with an invisible text layer (spec 5.1); everything downstream reads this one. */
export function searchableBlobKey(showId: string, documentId: string, versionId: string): string {
  return `${versionPrefix(showId, documentId, versionId)}/searchable.pdf`
}

export function pageThumbBlobKey(
  showId: string,
  documentId: string,
  versionId: string,
  index: number,
): string {
  return `${versionPrefix(showId, documentId, versionId)}/pages/${index}/thumb.png`
}

export function pageWordsBlobKey(
  showId: string,
  documentId: string,
  versionId: string,
  index: number,
): string {
  return `${versionPrefix(showId, documentId, versionId)}/pages/${index}/words.json`
}

/** A cached page render, made on demand (not during processing). */
export function pageImageBlobKey(
  showId: string,
  documentId: string,
  versionId: string,
  index: number,
  maxPx: number,
): string {
  return `${versionPrefix(showId, documentId, versionId)}/pages/${index}/image-${maxPx}.jpg`
}

/**
 * An export's file. The nonce is server-generated per upload, so two uploads racing on one export
 * id never write the same key (the loser deletes its own blob).
 */
export function exportBlobKey(
  showId: string,
  exportId: string,
  nonce: string,
  ext: 'pdf' | 'csv' | 'xlsx',
): string {
  return `shows/${showId}/exports/${exportId}/${nonce}.${ext}`
}

/** The show and export a `shows/{showId}/exports/{exportId}/...` key belongs to, or null for any other key. */
export function parseExportKey(key: string): { showId: string; exportId: string } | null {
  const segments = key.split('/')
  if (segments.length !== 5 || segments[0] !== 'shows' || segments[2] !== 'exports') return null
  return { showId: segments[1], exportId: segments[3] }
}
