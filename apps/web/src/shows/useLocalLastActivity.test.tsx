import { renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ sql: [] as string[] }))
vi.mock('@powersync/react', () => ({
  useQuery: (sql: string) => {
    h.sql.push(sql)
    return { data: [{ show_id: 's1', at: '2026-10-16T11:00:00Z' }] }
  },
}))
vi.mock('../auth/session', () => ({ useSessionUser: () => ({ data: { id: 'u1' } }) }))

import { NO_ACTIVITY_SQL, useLocalLastActivity } from './useShowSummaries'

test('the four-table scan runs only while the server answer is missing', () => {
  h.sql.length = 0
  renderHook(() => useLocalLastActivity(false))
  expect(h.sql).toEqual([NO_ACTIVITY_SQL])
  expect(NO_ACTIVITY_SQL).not.toMatch(/\bFROM\b/i)

  h.sql.length = 0
  const { result } = renderHook(() => useLocalLastActivity(true))
  expect(h.sql[0]).toMatch(/FROM cues/)
  expect(result.current.get('s1')).toBe('2026-10-16T11:00:00Z')
})
