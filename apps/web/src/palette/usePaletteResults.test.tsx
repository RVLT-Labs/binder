import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerDocumentHost, resetPaletteState } from './paletteState'
import { usePaletteResults } from './usePaletteResults'

const h = vi.hoisted(() => ({ search: vi.fn(), openSearch: vi.fn() }))

vi.mock('@powersync/react', () => ({
  useQuery: (sql: string) => {
    if (sql.includes('FROM cues')) return { data: [] }
    return { data: [{ n: 1 }] }
  },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../markup/useDepartments', () => ({
  useDepartments: () => [
    { id: 'lx', code: 'LX', colour: '#C9811F', number_format: 'decimal', hidden: 0 },
  ],
}))
vi.mock('../markup/useLayers', () => ({
  useLayers: () => ({
    state: { hidden: [] },
    editable: [{ kind: 'department', id: 'lx' }],
    store: { get: () => ({ hidden: [] }), setHidden: vi.fn() },
  }),
}))
vi.mock('../search/useDocumentSearch', () => ({
  useDocumentSearch: () => ({ search: h.search }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  h.search.mockReset()
  h.search.mockResolvedValue([
    { pageIndex: 0, lineIndex: 1 },
    { pageIndex: 0, lineIndex: 1 },
    { pageIndex: 2, lineIndex: 4 },
  ])
  resetPaletteState()
  registerDocumentHost({
    documentId: 'd1',
    versionId: 'v1',
    pageCount: 43,
    goToPage: vi.fn(),
    searchFor: h.openSearch,
    openPrint: vi.fn(),
    calling: false,
    toggleCalling: vi.fn(),
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  resetPaletteState()
})

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
}

it('"lx 12" searches the script for "12" and counts the distinct lines', async () => {
  const { result } = renderHook(() => usePaletteResults('lx 12', { showId: 's1', docId: 'd1' }))
  await settle()
  expect(h.search).toHaveBeenCalledWith('12')
  expect(h.search).not.toHaveBeenCalledWith('lx 12')
  expect(result.current.script.map((r) => r.label)).toEqual(['2 lines contain “12”'])
  result.current.script[0].run()
  expect(h.openSearch).toHaveBeenCalledWith('12')
})

it('"lx" alone runs no script search, and words search as typed', async () => {
  const bare = renderHook(() => usePaletteResults('lx', { showId: 's1', docId: 'd1' }))
  await settle()
  expect(h.search).not.toHaveBeenCalled()
  expect(bare.result.current.script).toEqual([])
  renderHook(() => usePaletteResults('wind', { showId: 's1', docId: 'd1' }))
  await settle()
  expect(h.search).toHaveBeenCalledWith('wind')
})
