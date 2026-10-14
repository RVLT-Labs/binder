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
