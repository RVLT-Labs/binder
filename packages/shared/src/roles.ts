import type { Role } from './types'

export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 }

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}
