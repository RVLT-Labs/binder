import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { resetPaletteState, usePaletteHost } from '../palette/paletteState'
import { Route as DocumentRoute } from './shows.$showId.docs.$docId'

// A component test of the real document route + router history + Print registration.
// These are labelled synthetic local query results, not an authenticated browser fixture.
const fixture = vi.hoisted(() => ({
  mounts: 0,
  menuPrint: null as null | ((opener: HTMLElement) => void),
  barPrint: null as null | ((opener: HTMLElement) => void),
}))
vi.mock('@powersync/react', () => ({
  useQuery: (sql: string) => ({
    isLoading: false,
    data: sql.includes('FROM documents')
      ? [{ id: 'doc', title: 'Synthetic document', current_version_id: 'v1' }]
      : sql.includes('FROM document_versions')
        ? [{ id: 'v1', status: 'ready', searchable_key: 'synthetic.pdf', version_number: 1 }]
        : sql.includes('FROM pages')
          ? [{ id: 'page', width: 612, height: 792 }]
          : [],
  }),
}))
vi.mock('../markup/MarkupSession', async () => {
  const { useEffect } = await import('react')
  return {
    MarkupSessionProvider: ({ children }: { children: ReactNode }) => {
      useEffect(() => {
        fixture.mounts++
      }, [])
      return children
    },
    useMarkupSession: () => ({ viewer: { current: null }, active: null }),
  }
})
vi.mock('../exports/PrintDialog', () => ({
  PrintButton: () => <button type="button">Print button</button>,
  PrintDialog: () => (
    <div role="dialog" aria-label="Synthetic Print">
      Print options
    </div>
  ),
}))
vi.mock('../viewer/Viewer', () => ({
  Viewer: ({
    calling,
    phoneItems,
  }: {
    calling?: unknown
    phoneItems: (close: () => void, opener: () => null) => ReactNode
  }) => (
    <div data-testid="viewer" data-mode={calling ? 'calling' : 'markup'}>
      {!calling &&
        phoneItems(
          () => {},
          () => null,
        )}
    </div>
  ),
}))
vi.mock('../viewer/DocumentControls', () => ({
  DocumentControls: ({
    onCalling,
    onPrint,
  }: {
    onCalling: () => void
    onPrint: (opener: HTMLElement) => void
  }) => {
    fixture.barPrint = onPrint
    return (
      <button type="button" onClick={onCalling}>
        Enter Calling
      </button>
    )
  },
  documentMenuItems: ({ onPrint }: { onPrint: (opener: HTMLElement) => void }) => {
    fixture.menuPrint = onPrint
    return null
  },
}))
vi.mock('../markup/UndoRedoButtons', () => ({ UndoRedoButtons: () => null }))
vi.mock('../markup/useMarkupShortcuts', () => ({ useMarkupShortcuts: () => {} }))
vi.mock('../revisions/useCanUpload', () => ({ useCanUpload: () => false }))
vi.mock('../revisions/useReviewCount', () => ({ useReviewCount: () => 0 }))
vi.mock('../revisions/api', () => ({
  useVersionAnchors: () => ({ anchors: null, loading: false }),
}))
vi.mock('../palette/useCanRenumber', () => ({ useRenumber: () => ({ can: false }) }))
vi.mock('../presence/PresencePublisher', () => ({ PresencePublisher: () => null }))
vi.mock('../calling/useWakeLock', () => ({ useWakeLock: () => {} }))
vi.mock('../shell/shellInert', () => ({ setShellInert: () => {} }))

let host: ReturnType<typeof usePaletteHost>
function HostProbe() {
  host = usePaletteHost()
  return null
}
afterEach(() => resetPaletteState())

async function mount() {
  fixture.mounts = 0
  const history = createMemoryHistory({ initialEntries: ['/shows/show/docs/doc'] })
  const root = createRootRoute({ component: Outlet })
  const document = createRoute({
    getParentRoute: () => root,
    path: '/shows/$showId/docs/$docId',
    validateSearch: DocumentRoute.options.validateSearch,
    component: DocumentRoute.options.component,
  })
  const router = createRouter({ routeTree: root.addChildren([document]), history })
  await router.load()
  render(
    <>
      <HostProbe />
      <RouterProvider router={router} />
    </>,
  )
  await screen.findByTestId('viewer')
  return { router, history }
}
async function go(history: ReturnType<typeof createMemoryHistory>, direction: 'back' | 'forward') {
  await act(async () => {
    history[direction]()
  })
  await waitFor(() =>
    expect(screen.getByTestId('viewer').getAttribute('data-mode')).toBe(
      direction === 'forward' ? 'calling' : 'markup',
    ),
  )
}

test('round3 actual history Back / Print / Forward closes Print on the retained document route', async () => {
  const { history } = await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Enter Calling' }))
  await waitFor(() => expect(host?.calling).toBe(true))
  await go(history, 'back')
  fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
  expect(screen.getByRole('dialog', { name: 'Synthetic Print' })).toBeTruthy()
  await go(history, 'forward')
  expect(fixture.mounts).toBe(1) // No remount can hide the retained-state defect.
  expect(screen.queryByRole('dialog', { name: 'Synthetic Print' })).toBeNull()
  await go(history, 'back')
  expect(screen.queryByRole('dialog', { name: 'Synthetic Print' })).toBeNull()
  fireEvent.keyDown(window, { key: 'p', metaKey: true })
  expect(screen.getByRole('dialog', { name: 'Synthetic Print' })).toBeTruthy()
})

test('round3 every retained route Print callback and the registered host refuse Calling', async () => {
  const { history } = await mount()
  const menuPrint = fixture.menuPrint
  const barPrint = fixture.barPrint
  const registeredPrint = host?.openPrint
  if (!menuPrint || !barPrint || !registeredPrint) throw new Error('Expected ready Print callbacks')
  fireEvent.click(screen.getByRole('button', { name: 'Enter Calling' }))
  await waitFor(() => expect(host?.calling).toBe(true))
  act(() => {
    menuPrint(document.body)
    barPrint(document.body)
    registeredPrint(null)
    host?.openPrint(null)
  })
  fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
  expect(screen.queryByRole('dialog')).toBeNull()
  await go(history, 'back')
  expect(screen.queryByRole('dialog')).toBeNull() // Gating render alone must not queue Print for exit.
})
