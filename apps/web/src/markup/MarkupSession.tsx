import { type CueType, canEditLayer, type LayerRef, layerKey, type WordLayer } from '@binder/shared'
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
import { cueToolState } from './activeDepartment'
import type { LayerState, LayerStore } from './layerState'
import type { CueRowWithDept, MarkupView } from './markupView'
import { deleteCue, type EditContext, insertCue, updateCue } from './mutations'
import { anchorAt, numberAt } from './placement'
import { clearSelection, select } from './selection'
import { effectiveSnap, loadSnapOverride, saveSnapOverride } from './snapPref'
import type { DepartmentRow } from './useDepartments'
import { useLayers } from './useLayers'
import { useMarkup } from './useMarkup'
import { loadWordLayer } from './wordLayers'

export const ARCHIVED_HINT = 'This show is archived, so its markup is read-only.'

type Point = { x: number; y: number }

export interface MarkupSession {
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
  /** Why nothing can be edited (an archived show), or null. */
  readOnly: string | null
  /** Where the cue tool places cues, or why it is disabled. */
  cueTarget: { departmentId: string } | { disabled: string }
  snap: boolean
  setSnap(on: boolean): void
  view: MarkupView
  /** The edit context as of now (the live membership scope), or null until it has synced. */
  editContext(): EditContext | null
  /** Whether the user may move, edit, and delete this cue now: an editable, unlocked layer of a live show. */
  canEditCue(cue: { department_id: string | null }): boolean
  /** `words` is the page's word layer when the caller already has it; otherwise it is loaded. */
  placeCue(pageIndex: number, point: Point, type: CueType, words?: WordLayer | null): Promise<void>
  moveCue(id: string, pageIndex: number, point: Point): Promise<void>
  removeCue(id: string): Promise<void>
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
  children,
}: MarkupSessionProviderProps) {
  const db = usePowerSync()
  const { userId, scope, departments, editable, active, state: layers, store } = useLayers(showId)
  const view = useMarkup(showId, versionId)
  const { data: shows } = useQuery<Pick<ShowRow, 'status'>>(
    'SELECT status FROM shows WHERE id = ?',
    [showId],
  )
  const [snapOverride, setSnapOverride] = useState(() => loadSnapOverride(documentId))
  const hover = useRef<{ pageIndex: number; point: Point } | null>(null)
  // A selection belongs to the version it was made on (the provider is keyed by version).
  useEffect(() => () => clearSelection(), [])

  const readOnly = shows[0]?.status === 'archived' ? ARCHIVED_HINT : null
  const cueTarget = cueToolState({
    readOnly,
    active,
    lastActiveDepartment: layers.lastDepartment,
    editable,
    locked: layers.locked,
    departmentCode: (id) => departments.find((d) => d.id === id)?.code ?? '?',
  })
  const snap = effectiveSnap(snapDefault, snapOverride)

  /** The live edit context: the membership scope as it is now, never a copy from an earlier render. */
  const ctx: EditContext | null = scope && userId ? { showId, userId, scope } : null
  const latest = useRef({ ctx, readOnly, editable, locked: layers.locked, cueTarget, snap, pages })
  latest.current = { ctx, readOnly, editable, locked: layers.locked, cueTarget, snap, pages }

  const editContext = useCallback(() => latest.current.ctx, [])

  const canEditCue = useCallback((cue: { department_id: string | null }) => {
    const now = latest.current
    if (now.readOnly || !now.ctx || !cue.department_id) return false
    const layer: LayerRef = { kind: 'department', id: cue.department_id }
    const key = layerKey(layer)
    return (
      now.editable.some((l) => layerKey(l) === key) &&
      !now.locked.includes(key) &&
      canEditLayer(now.ctx.scope, now.ctx.userId, layer)
    )
  }, [])

  const anchorFor = useCallback(
    async (pageIndex: number, point: Point, loaded?: WordLayer | null) => {
      const page = latest.current.pages[pageIndex]
      const snapOn = latest.current.snap
      const words =
        !snapOn || !page?.words_key ? null : (loaded ?? (await loadWordLayer(page.words_key)))
      return anchorAt({
        documentId,
        documentVersionId: versionId,
        pageIndex,
        point,
        words,
        snap: snapOn,
      })
    },
    [documentId, versionId],
  )

  const placeCue = useCallback(
    async (pageIndex: number, point: Point, type: CueType, words?: WordLayer | null) => {
      const target = latest.current.cueTarget
      if ('disabled' in target) return
      try {
        const anchor = await anchorFor(pageIndex, point, words)
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
      } catch (err) {
        report(err)
      }
    },
    [db, versionId, anchorFor],
  )

  const moveCue = useCallback(
    async (id: string, pageIndex: number, point: Point) => {
      try {
        const anchor = await anchorFor(pageIndex, point)
        const ctxNow = latest.current.ctx
        if (!ctxNow) return
        await updateCue(db, ctxNow, id, { anchor })
      } catch (err) {
        report(err)
      }
    },
    [db, anchorFor],
  )

  const removeCue = useCallback(
    async (id: string) => {
      const ctxNow = latest.current.ctx
      if (!ctxNow) return
      try {
        await deleteCue(db, ctxNow, id)
        clearSelection()
      } catch (err) {
        report(err)
      }
    },
    [db],
  )

  const showCue = useCallback(
    (cue: CueRowWithDept) => {
      select('cues', cue.id)
      viewer.current?.scrollToPoint(cue.anchor.pageIndex, cue.anchor.y)
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
    cueTarget,
    snap,
    setSnap,
    view,
    editContext,
    canEditCue,
    placeCue,
    moveCue,
    removeCue,
    showCue,
    hover,
    viewer,
  }
  return <Context.Provider value={session}>{children}</Context.Provider>
}
