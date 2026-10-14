import type { AnnotationFields, AnnotationType, LayerRef, TextAnchor } from '@binder/shared'
import type { AbstractPowerSyncDatabase } from '@powersync/web'
import { type RefObject, useCallback, useMemo } from 'react'
import { pushNotice } from '../components/noticeStore'
import { deleteAnnotation, type EditContext, insertAnnotation, updateAnnotation } from './mutations'
import { clearSelection, markFresh, select } from './selection'

type Point = { x: number; y: number }

export interface AnnotationDeps {
  db: Pick<AbstractPowerSyncDatabase, 'getOptional' | 'writeTransaction'>
  documentId: string
  versionId: string
  /** The session's live state, read at the moment of each write and never captured. */
  now: RefObject<{
    ctx: EditContext | null
    readOnly: string | null
    annotationTarget: { layer: LayerRef } | { disabled: string }
  }>
  /** Why the user may not change anything on this layer now (archived, scope, lock), or null. */
  whyCantEditLayer(layer: LayerRef): string | null
}

export interface PlaceInput {
  type: AnnotationType
  pageIndex: number
  /** The anchor point, in displayed points. */
  point: Point
  geometry?: Record<string, number>
  text?: string
  /** A highlight's bound word range. */
  textAnchor?: TextAnchor
}

export interface AnnotationActions {
  /** Draws a new annotation on the active layer and selects it; resolves to its id, or null if refused. */
  placeAnnotation(input: PlaceInput): Promise<string | null>
  /** Changes an annotation, checking its stored layer (and any layer it moves to) first. */
  editAnnotation(id: string, patch: Partial<AnnotationFields>): Promise<void>
  removeAnnotation(id: string): Promise<void>
  /** Binds a highlight to a newly dragged word range, on the page where it was dragged. */
  rebindHighlight(id: string, pageIndex: number, text: TextAnchor, point: Point): Promise<void>
}

function report(err: unknown) {
  pushNotice({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
}

const layerOf = (row: { layer_kind: string | null; layer_id: string | null }): LayerRef => ({
  kind: row.layer_kind === 'personal' ? 'personal' : 'department',
  id: row.layer_id ?? '',
})

/** The session's annotation writes. Each re-checks the stored row's layer, as cue moves and deletes do. */
export function useAnnotationActions({
  db,
  documentId,
  versionId,
  now,
  whyCantEditLayer,
}: AnnotationDeps): AnnotationActions {
  /**
   * The rights check every change makes itself, whoever calls it: the annotation as stored now, and
   * the layer a patch moves it to. False (with a notice saying why) when it may not change; false
   * quietly when it has gone.
   */
  const mayChange = useCallback(
    async (id: string, patch?: Partial<AnnotationFields>) => {
      const row = await db.getOptional<{ layer_kind: string | null; layer_id: string | null }>(
        'SELECT layer_kind, layer_id FROM annotations WHERE id = ?',
        [id],
      )
      if (!row) return false
      const reasons = [whyCantEditLayer(layerOf(row))]
      if (patch && (patch.layerKind || patch.layerId)) {
        reasons.push(
          whyCantEditLayer(
            layerOf({
              layer_kind: patch.layerKind ?? row.layer_kind,
              layer_id: patch.layerId ?? row.layer_id,
            }),
          ),
        )
      }
      const reason = reasons.find((r) => r !== null) ?? null
      if (reason) pushNotice({ kind: 'error', message: reason })
      return reason === null
    },
    [db, whyCantEditLayer],
  )

  const placeAnnotation = useCallback(
    async ({ type, pageIndex, point, geometry = {}, text = '', textAnchor }: PlaceInput) => {
      const target = now.current?.annotationTarget
      const ctx = now.current?.ctx
      if (!target || 'disabled' in target || !ctx || now.current?.readOnly) return null
      try {
        const id = await insertAnnotation(db as never, ctx, {
          layerKind: target.layer.kind,
          layerId: target.layer.id,
          anchor: {
            documentId,
            documentVersionId: versionId,
            pageIndex,
            x: point.x,
            y: point.y,
            ...(textAnchor ? { text: textAnchor } : {}),
            status: 'ok',
          },
          type,
          geometry,
          text,
          style: {},
        })
        // A note starts with placeholder text; its editor takes focus so the real text is typed next.
        if (type === 'note') markFresh(id)
        select('annotations', id)
        return id
      } catch (err) {
        report(err)
        return null
      }
    },
    [db, documentId, versionId, now],
  )

  const editAnnotation = useCallback(
    async (id: string, patch: Partial<AnnotationFields>) => {
      try {
        if (!(await mayChange(id, patch))) return
        const ctx = now.current?.ctx
        if (!ctx) return
        await updateAnnotation(db as never, ctx, id, patch)
      } catch (err) {
        report(err)
      }
    },
    [db, mayChange, now],
  )

  const removeAnnotation = useCallback(
    async (id: string) => {
      try {
        if (!(await mayChange(id))) return
        const ctx = now.current?.ctx
        if (!ctx) return
        await deleteAnnotation(db as never, ctx, id)
        clearSelection()
      } catch (err) {
        report(err)
      }
    },
    [db, mayChange, now],
  )

  const rebindHighlight = useCallback(
    (id: string, pageIndex: number, text: TextAnchor, point: Point) =>
      editAnnotation(id, {
        anchor: {
          documentId,
          documentVersionId: versionId,
          pageIndex,
          x: point.x,
          y: point.y,
          text,
          status: 'ok',
        },
      }),
    [editAnnotation, documentId, versionId],
  )

  return useMemo(
    () => ({ placeAnnotation, editAnnotation, removeAnnotation, rebindHighlight }),
    [placeAnnotation, editAnnotation, removeAnnotation, rebindHighlight],
  )
}
