/**
 * Editing an editor's department scope. A scope is `['*']` (every department) or a non-empty list
 * of department ids. Narrowing never turns into widening: the last checked department cannot be
 * unchecked, and "all departments" is only ever an explicit choice of its own.
 */

/** The scope after ticking or unticking `id`, or null when the change must not be sent. */
export function nextScope(current: string[], id: string, on: boolean): string[] | null {
  const ids = current.filter((d) => d !== '*')
  if (on) return ids.includes(id) ? ids : [...ids, id]
  if (!ids.includes(id) || ids.length <= 1) return null
  return ids.filter((d) => d !== id)
}

/** False for the only checked department (and for any department of an all-departments scope). */
export function canUncheckDepartment(current: string[], id: string): boolean {
  return nextScope(current, id, false) !== null
}

export const LAST_DEPARTMENT_HINT =
  "An editor needs at least one department; choose 'All departments' to grant every one"
