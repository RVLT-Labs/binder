import {
  canEditLayer,
  type LayerRef,
  layerKey,
  type MembershipScope,
  parseLayerKey,
} from '@binder/shared'

/** Per user and device: which layers are hidden and which one new work goes onto (layer keys). */
export interface LayerPrefs {
  hidden: string[]
  active: string | null
}

const DEFAULTS = (): LayerPrefs => ({ hidden: [], active: null })

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')

export function loadLayerPrefs(userId: string, showId: string): LayerPrefs {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(`binder.layers.${userId}.${showId}`) ?? 'null',
    )
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const { hidden, active } = parsed as Record<string, unknown>
      return {
        hidden: isStrings(hidden) ? hidden : [],
        active: typeof active === 'string' ? active : null,
      }
    }
  } catch {
    // unreadable or blocked: defaults
  }
  return DEFAULTS()
}

export function saveLayerPrefs(userId: string, showId: string, prefs: LayerPrefs): void {
  try {
    localStorage.setItem(`binder.layers.${userId}.${showId}`, JSON.stringify(prefs))
  } catch {
    // storage blocked: the choice lasts only as long as the page
  }
}

/** Locked layers (keys) last for the tab's session only; locking never affects anyone else. */
export function loadLocks(showId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(`binder.locks.${showId}`) ?? '[]')
    return isStrings(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveLocks(showId: string, keys: string[]): void {
  try {
    sessionStorage.setItem(`binder.locks.${showId}`, JSON.stringify(keys))
  } catch {
    // storage blocked
  }
}

/** The layers the user may edit: visible departments the matrix allows, in order, then their personal layer. */
export function editableLayers(
  scope: MembershipScope,
  userId: string,
  departments: Array<{ id: string; hidden: boolean }>,
): LayerRef[] {
  const layers: LayerRef[] = departments
    .filter((d) => !d.hidden)
    .map((d) => ({ kind: 'department' as const, id: d.id }))
    .filter((l) => canEditLayer(scope, userId, l))
  return [...layers, { kind: 'personal', id: userId }]
}

/** The stored active layer if still editable, else the first editable department, else personal. */
export function resolveActiveLayer(prefs: LayerPrefs, editable: LayerRef[]): LayerRef {
  const stored = prefs.active ? parseLayerKey(prefs.active) : null
  const keep = stored && editable.find((l) => layerKey(l) === layerKey(stored))
  if (keep) return keep
  return (
    editable.find((l) => l.kind === 'department') ??
    editable.find((l) => l.kind === 'personal') ??
    (editable[0] as LayerRef)
  )
}
