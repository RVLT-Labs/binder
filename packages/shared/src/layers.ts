import type { LayerRef } from './markup'
import type { Role } from './types'

/** What a member may touch: their role and the departments they are scoped to (`['*']` is all). */
export interface MembershipScope {
  role: Role
  departments: string[]
}

/** Every member sees every department layer; a personal layer is visible only to its owner. */
export function canSeeLayer(userId: string, layer: LayerRef): boolean {
  return layer.kind === 'department' || layer.id === userId
}

/**
 * The layer permission matrix (spec 4.1, 4.11). Archived shows are refused separately, server side.
 * Owners edit every visible layer, editors the departments in their scope, viewers nothing but
 * their own personal layer. Another user's personal layer is never editable.
 */
export function canEditLayer(m: MembershipScope, userId: string, layer: LayerRef): boolean {
  if (!canSeeLayer(userId, layer)) return false
  if (layer.kind === 'personal') return true
  if (m.role === 'owner') return true
  if (m.role === 'viewer') return false
  return m.departments.includes('*') || m.departments.includes(layer.id)
}
