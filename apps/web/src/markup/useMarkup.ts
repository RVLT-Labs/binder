import type { Anchor } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import { useSessionUser } from '../auth/session'
import { pickForVersion } from '../revisions/versionView'
import { useLayerState } from './layerState'
import { type AnnotationRow, type CueRowWithDept, groupMarkup, type MarkupView } from './markupView'

export type { AnnotationRow, CueRowWithDept }

type RawCue = Parameters<typeof groupMarkup>[0][number]
type RawAnnotation = Parameters<typeof groupMarkup>[1][number]

/** Cues on a document version (`documentVersionId`) or anywhere in a document (`documentId`). */
const cuesBy = (field: 'documentVersionId' | 'documentId') => `
  SELECT c.*, d.code AS dept_code, d.colour AS dept_colour,
         d.number_format AS dept_number_format, d.sort_order AS dept_sort_order,
         d.hidden AS dept_hidden
  FROM cues c JOIN departments d ON d.id = c.department_id
  WHERE c.show_id = ? AND json_extract(c.anchor, '$.${field}') = ?`

const annotationsBy = (field: 'documentVersionId' | 'documentId') => `
  SELECT * FROM annotations
  WHERE show_id = ? AND json_extract(anchor, '$.${field}') = ?`

const CUES_SQL = cuesBy('documentVersionId')
const CUES_OF_DOCUMENT_SQL = cuesBy('documentId')
const ANNOTATIONS_SQL = annotationsBy('documentVersionId')
const ANNOTATIONS_OF_DOCUMENT_SQL = annotationsBy('documentId')

/**
 * How a version that is not the document's current one is drawn. `anchors` is the server's answer
 * (`<table>:<rowId>` to the anchor the row had on the version), or null when offline, when only the
 * rows whose stored anchor still points at the version are drawn.
 */
export interface HistoricSource {
  documentId: string
  anchors: ReadonlyMap<string, Anchor> | null
}

/**
 * The cues and annotations placed on one document version, from the local database, limited to the
 * layers this user shows on this device and grouped by page in reading order.
 */
export function useMarkup(
  showId: string,
  versionId: string,
  historic: HistoricSource | null = null,
): MarkupView {
  const { data: user } = useSessionUser()
  const userId = user?.id ?? ''
  const { hidden } = useLayerState(userId, showId)
  const { data: cueRows } = useQuery<RawCue>(historic ? CUES_OF_DOCUMENT_SQL : CUES_SQL, [
    showId,
    historic ? historic.documentId : versionId,
  ])
  const { data: annotationRows } = useQuery<RawAnnotation>(
    historic ? ANNOTATIONS_OF_DOCUMENT_SQL : ANNOTATIONS_SQL,
    [showId, historic ? historic.documentId : versionId],
  )
  const remote = historic?.anchors ?? null
  const isHistoric = historic !== null
  return useMemo(() => {
    const cues = isHistoric ? pickForVersion('cues', cueRows, versionId, remote) : cueRows
    const annotations = isHistoric
      ? pickForVersion('annotations', annotationRows, versionId, remote)
      : annotationRows
    return groupMarkup(
      cues,
      // Another member's personal layer never syncs here; this keeps it so if one ever did.
      annotations.filter((a) => a.layer_kind !== 'personal' || a.layer_id === userId),
      new Set(hidden),
    )
  }, [cueRows, annotationRows, hidden, userId, isHistoric, versionId, remote])
}
