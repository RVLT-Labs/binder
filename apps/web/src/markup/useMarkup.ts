import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import { useSessionUser } from '../auth/session'
import { useLayerState } from './layerState'
import { type AnnotationRow, type CueRowWithDept, groupMarkup, type MarkupView } from './markupView'

export type { AnnotationRow, CueRowWithDept }

type RawCue = Parameters<typeof groupMarkup>[0][number]
type RawAnnotation = Parameters<typeof groupMarkup>[1][number]

const CUES_SQL = `
  SELECT c.*, d.code AS dept_code, d.colour AS dept_colour,
         d.number_format AS dept_number_format, d.hidden AS dept_hidden
  FROM cues c JOIN departments d ON d.id = c.department_id
  WHERE c.show_id = ? AND json_extract(c.anchor, '$.documentVersionId') = ?`

const ANNOTATIONS_SQL = `
  SELECT * FROM annotations
  WHERE show_id = ? AND json_extract(anchor, '$.documentVersionId') = ?`

/**
 * The cues and annotations placed on one document version, from the local database, limited to the
 * layers this user shows on this device and grouped by page in reading order.
 */
export function useMarkup(showId: string, versionId: string): MarkupView {
  const { data: user } = useSessionUser()
  const userId = user?.id ?? ''
  const { hidden } = useLayerState(userId, showId)
  const { data: cues } = useQuery<RawCue>(CUES_SQL, [showId, versionId])
  const { data: annotations } = useQuery<RawAnnotation>(ANNOTATIONS_SQL, [showId, versionId])
  return useMemo(
    () =>
      groupMarkup(
        cues,
        // Another member's personal layer never syncs here; this keeps it so if one ever did.
        annotations.filter((a) => a.layer_kind !== 'personal' || a.layer_id === userId),
        new Set(hidden),
      ),
    [cues, annotations, hidden, userId],
  )
}
