import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DocumentsData } from '../documents/useDocumentEntries'
import { ShowOverview } from './ShowOverview'

const docs = vi.hoisted(() => ({ value: null as unknown as DocumentsData }))

vi.mock('@powersync/react', () => ({
  useQuery: (sql: string) => ({
    data: sql.includes('FROM cues')
      ? [
          { id: 'a', department_id: 'lx', major: 12, minor: 0 },
          { id: 'b', department_id: 'lx', major: 12, minor: 0 },
        ]
      : [{ title: 'Songs for a New World' }],
  }),
}))
vi.mock('../markup/useDepartments', () => ({
  useDepartments: () => [{ id: 'lx', code: 'LX', colour: '#C9811F', hidden: 0 }],
}))
vi.mock('../markup/useMembership', () => ({ useMembership: () => ({ role: 'owner' }) }))
vi.mock('../documents/useDocumentEntries', () => ({ useDocumentEntries: () => docs.value }))
vi.mock('../documents/UploadProvider', () => ({
  useUpload: () => ({ canUpload: true, openUpload: () => {} }),
}))
// The parts that reach for sync, presence and the network are stood in for by their headings.
vi.mock('../presence/Avatars', () => ({
  BinderPresence: () => (
    <section aria-label="presence">
      <h2>In the binder now</h2>
    </section>
  ),
}))
vi.mock('./RecentActivity', () => ({
  RecentActivity: () => (
    <section aria-label="activity">
      <h2>Recent activity</h2>
    </section>
  ),
}))
vi.mock('./OfflineCard', () => ({
  OfflineCard: () => (
    <section aria-label="offline">
      <h2>Offline</h2>
    </section>
  ),
}))

test('the page reads in one order whatever the width: Needs you, Scripts, Cue lists, activity, who is here, Offline', async () => {
  docs.value = {
    loading: false,
    entries: [
      {
        kind: 'ready',
        key: 'd1:v1',
        docId: 'd1',
        title: 'Libretto',
        docKind: 'libretto',
        version: { id: 'v1', number: 1, label: null, pageCount: 3, searchable: true },
        kept: null,
        compare: null,
      },
    ],
    thumbs: new Map(),
    cachedVersions: new Set(),
    reviewCounts: new Map([['d1', 4]]),
  }
  const root = createRootRoute({ component: () => <ShowOverview showId="s1" /> })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: '$' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const view = render(<RouterProvider router={router} />)
  await waitFor(() => expect(view.container.querySelector('h2')).not.toBeNull())

  // Nothing is moved with `order`: the DOM is the reading and tab order at every width.
  expect(view.container.innerHTML).not.toMatch(/(?:^|[\s:"])order-/)
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
    'Needs you',
    'Scripts',
    'Cue lists by department',
    'Recent activity',
    'In the binder now',
    'Offline',
  ])
  // Needs you has both of its items here, and they come before the Scripts links.
  const links = screen.getAllByRole('link').map((l) => l.textContent)
  expect(links.indexOf('Review')).toBeLessThan(links.indexOf('Libretto'))
  expect(links.indexOf('Fix')).toBeLessThan(links.indexOf('Libretto'))
})
