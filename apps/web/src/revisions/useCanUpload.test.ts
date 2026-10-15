import { renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ role: undefined as string | undefined, status: 'prep' }))
vi.mock('@powersync/react', () => ({
  useQuery: (sql: string) => ({
    data: sql.includes('show_memberships') ? [{ role: h.role }] : [{ status: h.status }],
  }),
}))
vi.mock('../auth/session', () => ({ useSessionUser: () => ({ data: { id: 'u1' } }) }))

import { useCanUpload } from './useCanUpload'

const can = (role: string | undefined, status = 'prep') => {
  h.role = role
  h.status = status
  return renderHook(() => useCanUpload('s1')).result.current
}

test('owners and editors of a live show may upload; viewers, non-members and archived shows may not', () => {
  expect(can('owner')).toBe(true)
  expect(can('editor')).toBe(true)
  expect(can('viewer')).toBe(false)
  expect(can(undefined)).toBe(false)
  expect(can('owner', 'archived')).toBe(false)
})
