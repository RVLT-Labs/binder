import type { PresenceSelection } from '@binder/shared'
import { useMemo } from 'react'
import { useMarkupSession } from '../markup/MarkupSession'
import { useSelection } from '../markup/selection'
import { presenceSelection } from './peers'
import { usePresence } from './usePresence'

/**
 * Publishes where this tab is: the document, version and page in view, and the cue or annotation
 * selected. It renders nothing. Only rows on a department layer are ever published (everyone sees
 * those); a selection on a personal layer, or on a row this device cannot place on a layer, is not.
 */
export function PresencePublisher({
  showId,
  documentId,
  versionId,
  pageIndex,
}: {
  showId: string
  documentId: string
  versionId: string
  /** Zero-based page in view. */
  pageIndex: number
}) {
  const { view } = useMarkupSession()
  const selected = useSelection()
  const shared = useMemo<PresenceSelection | null>(() => {
    if (!selected) return null
    if (selected.table === 'cues') {
      const shown = view.ordered.some((c) => c.id === selected.id)
      return presenceSelection(selected, shown ? 'department' : null)
    }
    for (const rows of view.annotationsByPage.values()) {
      const row = rows.find((a) => a.id === selected.id)
      if (row) {
        const kind =
          row.layer_kind === 'department' || row.layer_kind === 'personal' ? row.layer_kind : null
        return presenceSelection(selected, kind)
      }
    }
    return presenceSelection(selected, null)
  }, [selected, view])
  usePresence(showId, { documentId, versionId, pageIndex, selection: shared })
  return null
}
