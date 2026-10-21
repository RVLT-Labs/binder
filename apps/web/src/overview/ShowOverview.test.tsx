import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { DocumentsData } from '../documents/useDocumentEntries'
import { ShowOverview } from './ShowOverview'

const docs = vi.hoisted(() => ({ value: null as unknown as DocumentsData }))
const show = vi.hoisted(() => ({ status: 'prep', role: 'owner' as string | null }))

vi.mock('@powersync/react', () => ({
  usePowerSync: () => ({ execute: async () => ({}) }),
  useQuery: (sql: string) => ({
    data: sql.includes('FROM cues')
      ? [
          { id: 'a', department_id: 'lx', major: 12, minor: 0 },
          { id: 'b', department_id: 'lx', major: 12, minor: 0 },
        ]
      : [{ title: 'Songs for a New World', status: show.status }],
  }),
}))
vi.mock('../markup/useDepartments', () => ({
  useDepartments: () => [{ id: 'lx', code: 'LX', colour: '#C9811F', hidden: 0 }],
}))
vi.mock('../markup/useMembership', () => ({
  useMembership: () => (show.role ? { role: show.role } : null),
}))
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

beforeEach(() => {
  show.status = 'prep'
  show.role = 'owner'
})

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

test('an active show has no archived banner and its columns start on the first row', async () => {
  const view = await renderOverview()
  expect(view.container.querySelector('section[aria-label="Archived show"]')).toBeNull()
  const columns = Array.from(view.container.querySelectorAll('[class*="min-[1025px]:col-start-"]'))
  expect(columns).toHaveLength(2)
  for (const column of columns) {
    expect(column.className).toContain('min-[1025px]:row-start-1')
    expect(column.className).not.toContain('row-start-2')
  }
})

test('an archived show opens with the banner across the top, before everything else', async () => {
  show.status = 'archived'
  const view = await renderOverview()
  const banner = view.container.querySelector('section[aria-label="Archived show"]')
  expect(banner).not.toBeNull()
  expect(banner?.textContent).toContain('This show is archived')
  // The first thing a reader meets after the title, on every width.
  const content = view.container.firstElementChild
  expect(content?.querySelector('section')).toBe(banner)
  // Across both columns on desktop, which then start on the second row.
  expect(banner?.className).toContain('min-[1025px]:col-span-2')
  expect(banner?.className).toContain('min-[1025px]:row-start-1')
  const columns = Array.from(view.container.querySelectorAll('[class*="min-[1025px]:col-start-"]'))
  expect(columns).toHaveLength(2)
  for (const column of columns) expect(column.className).toContain('min-[1025px]:row-start-2')
})

test('the banner offers Reactivate to the owner and asks everyone else to ask one', async () => {
  show.status = 'archived'
  const owner = await renderOverview()
  expect(owner.getByRole('button', { name: 'Reactivate show' })).toBeTruthy()
  owner.unmount()

  show.role = 'editor'
  const editor = await renderOverview()
  expect(editor.queryByRole('button', { name: 'Reactivate show' })).toBeNull()
  expect(editor.getByRole('region', { name: 'Archived show' }).textContent).toContain(
    'Ask an owner to reactivate it.',
  )
})

test('an archived show keeps the same headings, so nothing but the banner is added', async () => {
  show.status = 'archived'
  const view = await renderOverview()
  expect(headingsAt(view, 'wide')).toEqual([
    'Scripts',
    'Cue lists by department',
    'Recent activity',
    'In the binder now',
    'Needs you',
    'Offline',
  ])
})
