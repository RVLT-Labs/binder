import type { Anchor } from '@binder/shared'

/** Why a version that is not the document's current one cannot be edited. */
export const versionReadOnlyReason = (versionNumber: number): string =>
  `Viewing v${versionNumber} — read-only`

/** Shown beside the switcher when an older version is drawn from the device's rows alone. */
export const LOCAL_ANCHORS_ONLY = 'Showing local anchors only'

type Table = 'cues' | 'annotations'

/**
 * The rows of a document to draw on `versionId`. With the server's answer (`remote`, keyed
 * `<table>:<rowId>`) a row is shown when the server lists it, at the anchor the server gives: that
 * is where it was on the version, even though its stored anchor has since moved on. Without it only
 * rows whose own anchor still points at the version are shown, at that anchor.
 */
export function pickForVersion<T extends { id: string; anchor: string | null }>(
  table: Table,
  rows: readonly T[],
  versionId: string,
  remote: ReadonlyMap<string, Anchor> | null,
): T[] {
  const out: T[] = []
  for (const row of rows) {
    if (remote) {
      const anchor = remote.get(`${table}:${row.id}`)
      if (anchor) out.push({ ...row, anchor: JSON.stringify(anchor) })
      continue
    }
    if (!row.anchor) continue
    try {
      const parsed = JSON.parse(row.anchor) as { documentVersionId?: unknown }
      if (parsed.documentVersionId === versionId) out.push(row)
    } catch {
      // An anchor that is not JSON is placed nowhere.
    }
  }
  return out
}
