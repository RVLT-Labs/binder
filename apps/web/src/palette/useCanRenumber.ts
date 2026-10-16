import { useQuery } from '@powersync/react'
import { useLayers } from '../markup/useLayers'

/**
 * Whether the user may renumber the show's cues from script order: it has a document to read the
 * order from and they can edit at least one department layer. The palette's action and the script
 * top bar's "…" menu both offer Renumber on this.
 */
export function useCanRenumber(showId: string): boolean {
  const layers = useLayers(showId)
  const { data: documents } = useQuery<{ n: number }>(
    'SELECT COUNT(*) AS n FROM documents WHERE show_id = ?',
    [showId],
  )
  return (documents[0]?.n ?? 0) > 0 && layers.editable.some((l) => l.kind === 'department')
}
