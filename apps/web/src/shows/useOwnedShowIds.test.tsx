import { renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useOwnedShowIds } from './useOwnedShowIds'

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | undefined,
  rows: [] as { show_id: string }[],
  queries: [] as [string, unknown[]][],
}))

vi.mock('../auth/session', () => ({ useSessionUser: () => ({ data: state.user }) }))
vi.mock('@powersync/react', () => ({
  useQuery: (sql: string, params: unknown[]) => {
    state.queries.push([sql, params])
    return { data: state.rows }
  },
}))

test('is the set of shows the signed-in user owns, asked of their own membership rows', () => {
  state.rows = [{ show_id: 'a' }, { show_id: 'b' }]
  const { result } = renderHook(() => useOwnedShowIds())
  expect([...result.current]).toEqual(['a', 'b'])
  const [sql, params] = state.queries.at(-1) ?? ['', []]
  expect(sql).toContain("role = 'owner'")
  expect(sql).toContain('user_id = ?')
  expect(params).toEqual(['u1'])
})

test('is empty before there is a user or any membership, so nothing owner-only flashes on', () => {
  state.user = undefined
  state.rows = []
  const { result } = renderHook(() => useOwnedShowIds())
  expect(result.current.size).toBe(0)
  expect(state.queries.at(-1)?.[1]).toEqual([''])
})
