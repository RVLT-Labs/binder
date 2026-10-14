import type { LayerRef, MembershipScope } from '@binder/shared'
import { editableLayers, resolveActiveLayer } from './layerPrefs'
import { type LayerState, type LayerStore, useLayerState } from './layerState'
import { type DepartmentRow, useDepartments } from './useDepartments'
import { useMembership } from './useMembership'

export interface Layers {
  userId: string | null
  /** The live membership scope, or null until it has synced. */
  scope: MembershipScope | null
  /** Every department of the show, hidden ones included. */
  departments: DepartmentRow[]
  /** The layers this user may edit: non-hidden departments in scope, then personal. */
  editable: LayerRef[]
  /** The active layer, or null until the membership has synced. */
  active: LayerRef | null
  state: LayerState
  store: LayerStore
}

/** The signed-in user's layers on a show: what they may edit, which is active, and their local choices. */
export function useLayers(showId: string): Layers {
  const membership = useMembership(showId)
  const userId = membership?.userId ?? null
  const departments = useDepartments(showId)
  const { store, ...state } = useLayerState(userId ?? '', showId)
  const scope: MembershipScope | null = membership
    ? { role: membership.role, departments: membership.departments }
    : null
  const editable =
    scope && userId
      ? editableLayers(
          scope,
          userId,
          departments.map((d) => ({ id: d.id, hidden: Boolean(d.hidden) })),
        )
      : []
  const active =
    editable.length > 0
      ? resolveActiveLayer({ hidden: [...state.hidden], active: state.active }, editable)
      : null
  return { userId, scope, departments, editable, active, state, store }
}
