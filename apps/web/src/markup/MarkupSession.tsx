import {
  type Anchor,
  type CueMark,
  type CueType,
  canEditLayer,
  isCaretMark,
  type LayerRef,
  layerKey,
  type MarkerSide,
  markOf,
  PERSONAL_LAYER_COLOUR,
  type TextAnchor,
  type WordLayer,
} from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { pushNotice } from '../components/noticeStore'
import type { PageRow, ShowRow } from '../powersync/schema'
import type { ViewerHandle } from '../viewer/Viewer'
import { annotationToolState, cueToolState } from './activeDepartment'
import { focusCueMarker } from './CueMarker'
import type { LayerState, LayerStore } from './layerState'
import { readMarkerSide } from './markerSideSettings'
import type { CueRowWithDept, MarkupView } from './markupView'
import { deleteCue, type EditContext, insertCue, updateCue } from './mutations'
import { markAnchorAt, numberAt } from './placement'
import { endRelocate } from './relocate'
import { clearSelection, select } from './selection'
import { effectiveSnap, loadSnapOverride, saveSnapOverride } from './snapPref'
import { readStamps } from './stampSettings'
import { type AnnotationActions, useAnnotationActions } from './useAnnotationActions'
import type { DepartmentRow } from './useDepartments'
import { useLayers } from './useLayers'
import { type HistoricSource, useMarkup } from './useMarkup'
import { loadWordLayer } from './wordLayers'
import { highlightPoint } from './wordRange'

const annotationLayer = (a: { layer_kind: string | null; layer_id: string | null }): LayerRef => ({
  kind: a.layer_kind === 'personal' ? 'personal' : 'department',
  id: a.layer_id ?? '',
})

export const ARCHIVED_HINT = 'This show is archived, so its markup is read-only.'

type Point = { x: number; y: number }

export interface MarkupSession extends AnnotationActions {
  showId: string
  documentId: string
  versionId: string
  pages: readonly PageRow[]
  userId: string | null
  /** Every department of the show, hidden ones included. */
  departments: DepartmentRow[]
  /** The layers this user may edit: non-hidden departments in scope, then personal. */
  editable: LayerRef[]
  /** The active layer, or null until the membership has synced. */
  active: LayerRef | null
  layers: LayerState
  store: LayerStore
  /** Why nothing can be edited (an archived show, or a version that is not current), or null. */
  readOnly: string | null
  /** Set when the version on screen is not the document's current one: "Viewing v1 — read-only". */
  versionReadOnly: string | null
  /** Where the cue tool places cues, or why it is disabled. */
  cueTarget: { departmentId: string } | { disabled: string }
  /** Where the annotation tools draw (the active layer), or why they are disabled. */
  annotationTarget: { layer: LayerRef } | { disabled: string }
  /** The show's stamp set (its own, else the defaults). */
  stamps: string[]
  /** The page margin a department's cue tags sit in (the show's setting; left by default). */
  markerSide(departmentId: string | null): MarkerSide
  snap: boolean
  setSnap(on: boolean): void
  view: MarkupView
  /** The edit context as of now (the live membership scope), or null until it has synced. */
  editContext(): EditContext | null
  /**
   * Why the user may not move, edit, or delete this cue now (archived show, locked layer, a layer
   * outside their scope), or null when they may.
   */
  whyCantEdit(cue: { department_id: string | null }): string | null
  /** `whyCantEdit(cue) === null`. */
  canEditCue(cue: { department_id: string | null }): boolean
  /** As `whyCantEdit`, for an annotation's layer (department or personal). */
  whyCantEditAnnotation(a: { layer_kind: string | null; layer_id: string | null }): string | null
  canEditAnnotation(a: { layer_kind: string | null; layer_id: string | null }): boolean
  /** `LX`, or `Personal`: how a layer is named to the user. */
  layerName(layer: LayerRef): string
  /** The layer's colour: a department's own, or the personal layer's grey. */
  layerColour(layer: LayerRef): string
  /**
   * `words` is the page's word layer when the caller already has it; otherwise it is loaded. `mark`
   * is how the cue marks its words (underline when omitted); a highlight takes the word under the
   * point, a line or pointer the character boundary nearest it.
   */
  placeCue(
    pageIndex: number,
    point: Point,
    type: CueType,
    words?: WordLayer | null,
    mark?: CueMark,
  ): Promise<void>
  /**
   * Places a cue on a dragged range of words: its anchor text is `text`, at the first word's left
   * edge and its line's centre. `words` is the page's layer when the caller has it.
   */
  placeCueRange(
    pageIndex: number,
    text: TextAnchor,
    type: CueType,
    mark: 'underline' | 'highlight',
    words?: WordLayer | null,
  ): Promise<void>
  /**
   * `dropped` is a cue dropped by its margin tag: a pointer outside the line's extent starts the
   * trigger at the line's first word, not the nearest.
   */
  moveCue(
    id: string,
    pageIndex: number,
    point: Point,
    options?: { dropped?: boolean },
  ): Promise<void>
  removeCue(id: string): Promise<void>
  /**
   * Puts a review item (a cue or annotation anchored to an older version) at a point of this
   * version, status `ok`. The same rights checks as any move apply.
   */
  relocate(
    table: 'cues' | 'annotations',
    id: string,
    pageIndex: number,
    point: Point,
  ): Promise<void>
  /** Selects a cue and scrolls it into view. */
  showCue(cue: CueRowWithDept): void
  /** The page and point under the pointer, for placing a cue from the keyboard. */
  hover: RefObject<{ pageIndex: number; point: Point } | null>
  viewer: RefObject<ViewerHandle | null>
}

const Context = createContext<MarkupSession | null>(null)

export function useMarkupSession(): MarkupSession {
  const session = useContext(Context)
  if (!session) throw new Error('useMarkupSession outside MarkupSessionProvider')
  return session
}

export interface MarkupSessionProviderProps {
  showId: string
  documentId: string
  versionId: string
  pages: readonly PageRow[]
  /** The document's `snap_to_text`. */
  snapDefault: number | null
  viewer: RefObject<ViewerHandle | null>
  /**
   * Set when `versionId` is not the document's current version: every tool, drag, shortcut and
   * editor that writes is then disabled with this reason, and undo and redo refuse.
   */
  versionReadOnly?: string | null
  /** The draw source for a version that is not current; see `useMarkup`. */
  historic?: HistoricSource | null
  children: ReactNode
}

function report(err: unknown) {
  pushNotice({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
}

/** The markup state and actions for one document version, shared by the overlay, panels, and keys. */
export function MarkupSessionProvider({
  showId,
  documentId,
  versionId,
  pages,
  snapDefault,
  viewer,
  versionReadOnly = null,
  historic = null,
  children,
}: MarkupSessionProviderProps) {
  const db = usePowerSync()
  const { userId, scope, departments, editable, active, state: layers, store } = useLayers(showId)
  const view = useMarkup(showId, versionId, historic)
  const { data: shows } = useQuery<Pick<ShowRow, 'status' | 'settings'>>(
    'SELECT status, settings FROM shows WHERE id = ?',
    [showId],
  )
  const [snapOverride, setSnapOverride] = useState(() => loadSnapOverride(documentId))
  const hover = useRef<{ pageIndex: number; point: Point } | null>(null)
  // A selection belongs to the version it was made on (the provider is keyed by version).
  useEffect(
    () => () => {
      clearSelection()
      endRelocate()
    },
    [],
  )

  const readOnly = shows[0]?.status === 'archived' ? ARCHIVED_HINT : versionReadOnly
  const departmentName = (id: string) => departments.find((d) => d.id === id)?.code ?? '?'
  const cueTarget = cueToolState({
    readOnly,
    active,
    lastActiveDepartment: layers.lastDepartment,
    editable,
    locked: layers.locked,
    hidden: layers.hidden,
    departmentCode: departmentName,
  })
  const layerName = (layer: LayerRef) =>
    layer.kind === 'personal' ? 'Personal' : departmentName(layer.id)
  const annotationTarget = annotationToolState({
    readOnly,
    active,
    editable,
    locked: layers.locked,
    hidden: layers.hidden,
    layerName,
  })
  const stamps = readStamps(shows[0]?.settings)
  const showSettings = shows[0]?.settings
  const markerSide = useCallback(
    (departmentId: string | null) => readMarkerSide(showSettings, departmentId ?? ''),
    [showSettings],
  )
  const snap = effectiveSnap(snapDefault, snapOverride)

  /** The live edit context: the membership scope as it is now, never a copy from an earlier render. */
  const ctx: EditContext | null = scope && userId ? { showId, userId, scope } : null
  const now = {
    ctx,
    readOnly,
    editable,
    locked: layers.locked,
    cueTarget,
    annotationTarget,
    snap,
    pages,
    layerName,
  }
  const latest = useRef(now)
  latest.current = now

  const editContext = useCallback(() => latest.current.ctx, [])

  /** Why the layer cannot be changed now (archived show, outside scope, locked), or null. */
  const whyCantEditLayer = useCallback((layer: LayerRef, noun: 'cues' | 'annotations') => {
    const now = latest.current
    if (now.readOnly) return now.readOnly
    const name = now.layerName(layer)
    const refusal =
      layer.kind === 'personal'
        ? "You can't edit another person's personal layer."
        : `You can't edit ${name} ${noun}.`
    if (!now.ctx || !layer.id) return refusal
    const key = layerKey(layer)
    if (
      !now.editable.some((l) => layerKey(l) === key) ||
      !canEditLayer(now.ctx.scope, now.ctx.userId, layer)
    ) {
      return refusal
    }
    if (now.locked.includes(key)) return `The ${name} layer is locked.`
    return null
  }, [])

  const whyCantEdit = useCallback(
    (cue: { department_id: string | null }) =>
      whyCantEditLayer({ kind: 'department', id: cue.department_id ?? '' }, 'cues'),
    [whyCantEditLayer],
  )

  const canEditCue = useCallback(
    (cue: { department_id: string | null }) => whyCantEdit(cue) === null,
    [whyCantEdit],
  )

  const whyCantEditAnnotation = useCallback(
    (a: { layer_kind: string | null; layer_id: string | null }) =>
      whyCantEditLayer(annotationLayer(a), 'annotations'),
    [whyCantEditLayer],
  )
  const canEditAnnotation = useCallback(
    (a: { layer_kind: string | null; layer_id: string | null }) =>
      whyCantEditAnnotation(a) === null,
    [whyCantEditAnnotation],
  )

  const annotations = useAnnotationActions({
    db,
    documentId,
    versionId,
    now: latest,
    whyCantEditLayer: useCallback(
      (layer) => whyCantEditLayer(layer, 'annotations'),
      [whyCantEditLayer],
    ),
  })

  /**
   * The rights check every move and delete makes itself, whoever calls it: the cue as stored now.
   * The cue's current anchor (null when unplaced) when it may change; null (with a notice saying
   * why) when it may not, and null quietly when it has gone.
   */
  const cueForChange = useCallback(
    async (id: string): Promise<{ anchor: Anchor | null } | null> => {
      const row = await db.getOptional<{ department_id: string | null; anchor?: string | null }>(
        'SELECT department_id, anchor FROM cues WHERE id = ?',
        [id],
      )
      if (!row) return null
      const reason = whyCantEdit(row)
      if (reason) {
        pushNotice({ kind: 'error', message: reason })
        return null
      }
      let anchor: Anchor | null = null
      try {
        anchor = row.anchor ? (JSON.parse(row.anchor) as Anchor) : null
      } catch {
        anchor = null
      }
      return { anchor }
    },
    [db, whyCantEdit],
  )
  const mayChange = useCallback(
    async (id: string) => (await cueForChange(id)) !== null,
    [cueForChange],
  )

  const anchorFor = useCallback(
    async (
      pageIndex: number,
      point: Point,
      loaded?: WordLayer | null,
      firstWordOutside = false,
      mark: CueMark = 'underline',
    ) => {
      const page = latest.current.pages[pageIndex]
      const snapOn = latest.current.snap
      const words =
        !snapOn || !page?.words_key ? null : (loaded ?? (await loadWordLayer(page.words_key)))
      return markAnchorAt({
        documentId,
        documentVersionId: versionId,
        pageIndex,
        point,
        words,
        snap: snapOn,
        firstWordOutside,
        mark,
      })
    },
    [documentId, versionId],
  )

  /** Numbers and inserts a cue at an anchor in the cue tool's department, then selects it. */
  const insertPlaced = useCallback(
    async (anchor: Anchor, type: CueType) => {
      const target = latest.current.cueTarget
      if ('disabled' in target) return
      const rows = await db.getAll<{ id: string; major: number; minor: number; anchor: string }>(
        `SELECT id, major, minor, anchor FROM cues
         WHERE department_id = ? AND json_extract(anchor, '$.documentVersionId') = ?`,
        [target.departmentId, versionId],
      )
      const number = numberAt(
        anchor,
        rows.map((r) => ({
          ...r,
          anchor: JSON.parse(r.anchor) as { pageIndex: number; y: number },
        })),
      )
      const now = latest.current
      if (!now.ctx || now.readOnly) return
      const id = await insertCue(db, now.ctx, {
        departmentId: target.departmentId,
        ...number,
        label: '',
        type,
        notes: '',
        colour: null,
        anchor,
      })
      select('cues', id)
    },
    [db, versionId],
  )

  const placeCue = useCallback(
    async (
      pageIndex: number,
      point: Point,
      type: CueType,
      words?: WordLayer | null,
      mark: CueMark = 'underline',
    ) => {
      if ('disabled' in latest.current.cueTarget) return
      try {
        await insertPlaced(await anchorFor(pageIndex, point, words, false, mark), type)
      } catch (err) {
        report(err)
      }
    },
    [insertPlaced, anchorFor],
  )

  const placeCueRange = useCallback(
    async (
      pageIndex: number,
      text: TextAnchor,
      type: CueType,
      mark: 'underline' | 'highlight',
      loaded?: WordLayer | null,
    ) => {
      if ('disabled' in latest.current.cueTarget) return
      try {
        const key = latest.current.pages[pageIndex]?.words_key
        const words = loaded ?? (key ? await loadWordLayer(key) : null)
        const at = words ? highlightPoint(words, text) : null
        if (!at) return
        const anchor: Anchor = {
          documentId,
          documentVersionId: versionId,
          pageIndex,
          x: at.x,
          y: at.y,
          text,
          status: 'ok',
          ...(mark === 'underline' ? {} : { mark }),
        }
        await insertPlaced(anchor, type)
      } catch (err) {
        report(err)
      }
    },
    [documentId, versionId, insertPlaced],
  )

  const moveCue = useCallback(
    async (id: string, pageIndex: number, point: Point, options: { dropped?: boolean } = {}) => {
      try {
        const current = await cueForChange(id)
        if (!current) return
        // A move keeps the cue's mark (and its tag): only where it sits changes.
        const was = current.anchor
        const mark = markOf(was)
        const placed = await anchorFor(
          pageIndex,
          point,
          undefined,
          options.dropped === true,
          isCaretMark(mark) ? mark : 'underline',
        )
        const anchor: Anchor = {
          ...placed,
          ...(mark === 'highlight' ? { mark } : {}),
          ...(was?.tag ? { tag: was.tag } : {}),
        }
        const ctxNow = latest.current.ctx
        if (!ctxNow) return
        await updateCue(db, ctxNow, id, { anchor })
      } catch (err) {
        report(err)
      }
    },
    [db, anchorFor, cueForChange],
  )

  const removeCue = useCallback(
    async (id: string) => {
      try {
        if (!(await mayChange(id))) return
        const ctxNow = latest.current.ctx
        if (!ctxNow) return
        await deleteCue(db, ctxNow, id)
        clearSelection()
      } catch (err) {
        report(err)
      }
    },
    [db, mayChange],
  )

  const relocate = useCallback(
    async (table: 'cues' | 'annotations', id: string, pageIndex: number, point: Point) => {
      if (table === 'cues') return moveCue(id, pageIndex, point)
      const moved: Anchor = {
        documentId,
        documentVersionId: versionId,
        pageIndex,
        x: point.x,
        y: point.y,
        status: 'ok',
      }
      await annotations.editAnnotation(id, { anchor: moved })
    },
    [documentId, versionId, moveCue, annotations.editAnnotation],
  )

  const showCue = useCallback(
    (cue: CueRowWithDept) => {
      select('cues', cue.id)
      viewer.current?.scrollToPoint(cue.anchor.pageIndex, cue.anchor.y)
      // Keyboard focus follows the walk, so the selected marker is the one a screen reader is on.
      focusCueMarker(cue.id)
    },
    [viewer],
  )

  const setSnap = useCallback(
    (on: boolean) => {
      saveSnapOverride(documentId, on)
      setSnapOverride(on)
    },
    [documentId],
  )

  const session: MarkupSession = {
    showId,
    documentId,
    versionId,
    pages,
    userId,
    departments,
    editable,
    active,
    layers,
    store,
    readOnly,
    versionReadOnly,
    cueTarget,
    annotationTarget,
    stamps,
    markerSide,
    snap,
    setSnap,
    view,
    editContext,
    whyCantEdit,
    canEditCue,
    whyCantEditAnnotation,
    canEditAnnotation,
    layerName,
    layerColour: (layer) =>
      layer.kind === 'personal'
        ? PERSONAL_LAYER_COLOUR
        : (departments.find((d) => d.id === layer.id)?.colour ?? PERSONAL_LAYER_COLOUR),
    ...annotations,
    placeCue,
    placeCueRange,
    moveCue,
    removeCue,
    relocate,
    showCue,
    hover,
    viewer,
  }
  return <Context.Provider value={session}>{children}</Context.Provider>
}
