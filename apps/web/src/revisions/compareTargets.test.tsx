import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Route as CompareRoute } from '../routes/shows.$showId.docs.$docId.compare'
import { TopBar } from '../shell/TopBar'
import { TopBarSlotsContext } from '../shell/TopBarSlots'

vi.mock('@powersync/react', () => ({
  useQuery: (sql: string) => ({
    data: sql.includes('FROM documents')
      ? [{ current_version_id: 'v3', title: 'Synthetic document' }]
      : [1, 2, 3].map((n) => ({ id: `v${n}`, version_number: n })),
  }),
}))
vi.mock('../components/SyncStatus', () => ({ SyncStatus: () => <span>Local unit fixture</span> }))
vi.mock('../revisions/useReviewCount', () => ({ useReviewCount: () => 0 }))
vi.mock('../revisions/useVersionText', () => ({
  useVersionText: () => ({ text: null, unavailable: 0 }),
  clearVersionTextCache: () => {},
}))
vi.mock('../revisions/ComparePane', () => ({ ComparePane: () => null }))
vi.mock('../panel/ContextPanel', () => ({ ContextPanel: () => null }))

function Composition() {
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const Page = CompareRoute.options.component
  if (!Page) throw new Error('Expected comparison route component')
  return (
    <TopBarSlotsContext value={{ actions, chip: null, phone: null }}>
      <TopBar
        phone={false}
        crumbs={[{ label: 'Synthetic comparison' }]}
        account={{ email: 'unused@example.invalid', name: 'Unused', signOut: async () => {} }}
        slotRefs={{ actions: setActions, chip: () => {}, phone: () => {} }}
      />
      <Page />
    </TopBarSlotsContext>
  )
}

test('round3 real compare route selects update history and reserve tablet targets within a growing shell bar', async () => {
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/shows/$showId/docs/$docId/compare',
    validateSearch: CompareRoute.options.validateSearch,
    component: Composition,
  })
  const history = createMemoryHistory({ initialEntries: ['/shows/s/docs/d/compare'] })
  const router = createRouter({ routeTree: root.addChildren([page]), history })
  await router.load()
  render(<RouterProvider router={router} />)
  const from = (await screen.findByRole('combobox', { name: 'From' })) as HTMLSelectElement
  const to = screen.getByRole('combobox', { name: 'To' }) as HTMLSelectElement
  expect([from.value, to.value]).toEqual(['v2', 'v3'])
  fireEvent.change(from, { target: { value: 'v1' } })
  await waitFor(() => expect(router.state.location.search).toMatchObject({ from: 'v1', to: 'v3' }))
  fireEvent.change(to, { target: { value: 'v2' } })
  await waitFor(() => expect(router.state.location.search).toMatchObject({ from: 'v1', to: 'v2' }))
  expect(history.length).toBe(1)
  // jsdom has no layout: reserve sizes structurally here; the host fixture measures real hits.
  for (const select of [from, to]) {
    expect(select.className).toContain('min-h-11')
    expect(select.className).toContain('min-w-11')
  }
  const header = from.closest('header')
  if (!header) throw new Error('Expected actual shell header')
  expect(header.className.split(' ')).not.toContain('h-[calc(44px+env(safe-area-inset-top))]')
  expect(header.className).toContain('flex-wrap')
})
