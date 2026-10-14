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

export function originalBlobKey(showId: string, documentId: string, versionId: string): string {
  return `shows/${showId}/documents/${documentId}/versions/${versionId}/original.pdf`
}
