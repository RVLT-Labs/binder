import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, waitFor } from '@testing-library/react'
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
  RecentActivity: ({ className }: { className?: string }) => (
    <section aria-label="activity" className={className}>
      <h2>Recent activity</h2>
    </section>
  ),
}))
vi.mock('../offline/OfflineButton', () => ({
  useOfflineCopy: () => ({ state: { phase: 'idle' }, running: false, start: async () => {} }),
  OfflineAction: () => <button type="button">Make available offline</button>,
}))
vi.mock('../offline/useOfflineSummary', () => ({ useOfflineSummary: () => null }))
vi.mock('./OfflineCard', () => ({
  OfflineCard: () => (
    <section aria-label="offline">
      <h2>Offline</h2>
    </section>
  ),
}))

/** The h2s a reader meets at a width: those not inside something the width hides. */
function headingsAt(view: ReturnType<typeof render>, width: 'phone' | 'wide') {
  const hidden = width === 'phone' ? '.max-md\\:hidden' : '.md\\:hidden'
  return Array.from(view.container.querySelectorAll('h2'))
    .filter((h) => !h.closest(hidden))
    .map((h) => h.textContent)
}

async function renderOverview() {
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
  return view
}

test('the DOM is the mockups: wide has the right column In the binder now, Needs you, Offline; the phone has Needs you first', async () => {
  const view = await renderOverview()
  // Nothing is moved with `order`: the DOM is the reading and tab order at every width.
  expect(view.container.innerHTML).not.toMatch(/(?:^|[\s:"])order-/)
  // Desktop and tablet (the tablet column has no mockup; it follows the desktop's).
  expect(headingsAt(view, 'wide')).toEqual([
    'Scripts',
    'Cue lists by department',
    'Recent activity',
    'In the binder now',
    'Needs you',
    'Offline',
  ])
  // Phone: Needs you moves to the top, the activity and links are left to their tabs.
  expect(headingsAt(view, 'phone')).toEqual([
    'Needs you',
    'Scripts',
    'Cue lists by department',
    'In the binder now',
    'Offline',
  ])
})

test('Needs you is drawn once for each arrangement, and each is hidden where it does not apply', async () => {
  const view = await renderOverview()
  const needs = Array.from(view.container.querySelectorAll('section')).filter(
    (s) => s.querySelector('h2')?.textContent === 'Needs you',
  )
  expect(needs).toHaveLength(2)
  // The phone's is first in the DOM and hidden from 768 up; the aside's is hidden below it.
  expect(needs[0].className).toContain('md:hidden')
  expect(needs[1].className).toContain('max-md:hidden')
  // Both carry both items.
  for (const section of needs) {
    const links = Array.from(section.querySelectorAll('a')).map((l) => l.textContent)
    expect(links).toEqual(['Review', 'Fix'])
  }
})

test('the Review and Fix links come before the Scripts links on the phone and after them on a wide screen', async () => {
  const view = await renderOverview()
  const all = Array.from(view.container.querySelectorAll('a'))
  const phoneReview = all.find((a) => a.textContent === 'Review')
  const scripts = all.find((a) => a.textContent === 'Libretto')
  // The first Review in the DOM is the phone's; the Scripts link follows it.
  expect(phoneReview?.compareDocumentPosition(scripts as Node)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
})
