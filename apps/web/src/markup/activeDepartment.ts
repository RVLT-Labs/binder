import type { LayerRef } from '@binder/shared'

export const NO_DEPARTMENT_HINT =
  "Cues go on a department layer, and you can't edit any in this show."

/**
 * Where the cue tool places a cue: the active layer when it is a department, otherwise the most
 * recently active editable department, else the first editable one. With none, the tool is disabled.
 */
export function cueTargetDepartment(
  active: LayerRef,
  lastActiveDepartment: string | null,
  editable: LayerRef[],
): { departmentId: string } | { disabled: string } {
  if (active.kind === 'department') return { departmentId: active.id }
  const departments = editable.filter((l) => l.kind === 'department')
  const last = departments.find((l) => l.id === lastActiveDepartment)
  const target = last ?? departments[0]
  return target ? { departmentId: target.id } : { disabled: NO_DEPARTMENT_HINT }
}

export const LOADING_LAYERS_HINT = 'Waiting for your layers to sync…'

export interface CueToolInput {
  /** Why the show cannot be edited (archived), or null. */
  readOnly: string | null
  /** Null until the membership has synced. */
  active: LayerRef | null
  lastActiveDepartment: string | null
  editable: LayerRef[]
  /** Locked layer keys. */
  locked: readonly string[]
  /** Layer keys the user has hidden on this device. */
  hidden: readonly string[]
  departmentCode: (id: string) => string
}

/** Where the cue tool (and the `c` key) places a cue now, or why it cannot. */
export function cueToolState(input: CueToolInput): { departmentId: string } | { disabled: string } {
  if (input.readOnly) return { disabled: input.readOnly }
  if (!input.active) return { disabled: LOADING_LAYERS_HINT }
  const target = cueTargetDepartment(input.active, input.lastActiveDepartment, input.editable)
  if ('disabled' in target) return target
  const key = `department:${target.departmentId}`
  const code = input.departmentCode(target.departmentId)
  // A cue placed on a hidden layer would vanish as it lands.
  if (input.hidden.includes(key)) return { disabled: `Show the ${code} layer to place cues on it` }
  if (input.locked.includes(key)) return { disabled: `The ${code} layer is locked.` }
  return target
}
