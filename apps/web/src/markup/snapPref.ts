/** The session's snap toggle for a document, overriding its `snap_to_text` default (spec 5.2). */
const key = (documentId: string) => `binder.snap.${documentId}`

export function loadSnapOverride(documentId: string): boolean | null {
  try {
    const value = sessionStorage.getItem(key(documentId))
    return value === 'on' ? true : value === 'off' ? false : null
  } catch {
    return null
  }
}

export function saveSnapOverride(documentId: string, on: boolean): void {
  try {
    sessionStorage.setItem(key(documentId), on ? 'on' : 'off')
  } catch {
    // storage blocked: the toggle lasts as long as the page
  }
}

/** The document's default (`snap_to_text`, 0 or 1 in SQLite) unless the session says otherwise. */
export function effectiveSnap(
  documentDefault: number | boolean | null,
  override: boolean | null,
): boolean {
  return override ?? Boolean(documentDefault)
}
