import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recallShow, rememberShow, useLastShowId, useRememberShow } from './lastShow'

const rows = vi.hoisted(() => ({ current: [] as { id: string }[] }))
vi.mock('@powersync/react', () => ({ useQuery: () => ({ data: rows.current }) }))

const EMAIL = 'jayden@example.test'

beforeEach(() => {
  localStorage.clear()
  rows.current = []
})

describe('useRememberShow', () => {
  it('stores the show once it exists on this device', () => {
    renderHook(() => useRememberShow(EMAIL, 's1', true))
    expect(recallShow(EMAIL)).toBe('s1')
  })

  it('does not store a show that was not found, and leaves the remembered one alone', () => {
    rememberShow(EMAIL, 'good')
    renderHook(() => useRememberShow(EMAIL, 'xyz', false))
    expect(recallShow(EMAIL)).toBe('good')
  })
})

describe('useLastShowId', () => {
  it('gives the remembered show while it is in the local shows list (archived included)', () => {
    rememberShow(EMAIL, 's1')
    rows.current = [{ id: 's1' }]
    expect(renderHook(() => useLastShowId(EMAIL)).result.current).toBe('s1')
  })

  it('gives nothing for a stale id that is not in the list', () => {
    rememberShow(EMAIL, 'gone')
    rows.current = []
    expect(renderHook(() => useLastShowId(EMAIL)).result.current).toBeUndefined()
  })

  it('gives nothing when no show was ever opened', () => {
    expect(renderHook(() => useLastShowId(EMAIL)).result.current).toBeUndefined()
  })
})
