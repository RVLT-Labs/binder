import type { LayerRef } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useLayers } from '../markup/useLayers'

/**
 * The department Renumber should open on: the one active in the document when the user can edit it,
 * otherwise the first department they can edit. Without this the cue list opens on its first visible
 * department, which a department-scoped editor may not be allowed to edit.
 */
export function renumberDepartment(
  editable: readonly LayerRef[],
  active: LayerRef | null,
): string | undefined {
  if (
    active?.kind === 'department' &&
    editable.some((l) => l.kind === 'department' && l.id === active.id)
  ) {
    return active.id
  }
  return editable.find((l) => l.kind === 'department')?.id
}

/** The cue list's address for "Renumber from script order": it opens the dialog on `department`. */
export interface RenumberSearch {
  renumber: true
  department: string | undefined
}

/**
 * Whether the user may renumber the show's cues from script order (it has a document to read the
 * order from and they can edit at least one department layer), and where the cue list should be
 * opened to do it. The palette's action and the script top bar's "…" menu both offer Renumber on this.
 */
export function useRenumber(showId: string): { can: boolean; search: RenumberSearch } {
  const layers = useLayers(showId)
  const { data: documents } = useQuery<{ n: number }>(
    'SELECT COUNT(*) AS n FROM documents WHERE show_id = ?',
    [showId],
  )
  const department = renumberDepartment(layers.editable, layers.active)
  return {
    can: (documents[0]?.n ?? 0) > 0 && department !== undefined,
    search: { renumber: true, department },
  }
}

export function useCanRenumber(showId: string): boolean {
  return useRenumber(showId).can
}
