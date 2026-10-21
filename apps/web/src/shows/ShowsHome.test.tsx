import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { ShowRow } from '../powersync/schema'
import { ShowsHome, type ShowsHomeProps } from './ShowsHome'

const row = (id: string, title: string, status = 'active'): ShowRow =>
  ({ id, title, status, updated_at: '2026-10-16T11:00:00Z' }) as ShowRow

const homeProps = (onNewShow: ShowsHomeProps['onNewShow']): ShowsHomeProps => ({
  shows: [],
  loading: false,
  cueCounts: {},
  greeting: 'Good evening, Jayden.',
  now: new Date('2026-10-16T12:00:00Z'),
  onNewShow,
  onRename: async () => {},
})

async function renderHome(props: Partial<ShowsHomeProps> = {}) {
  const onNewShow = vi.fn<(opener: HTMLElement) => void>()
  await renderInRouter(<ShowsHome {...homeProps(onNewShow)} {...props} />)
  return { onNewShow }
}

async function renderInRouter(node: ReactNode) {
  const root = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: 'shows/$showId' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { name: 'Shows' })
}

test('names the page Shows and greets the person', async () => {
  await renderHome()
  expect(screen.getByRole('heading', { level: 1, name: 'Shows' })).toBeTruthy()
  expect(screen.getByText('Good evening, Jayden.')).toBeTruthy()
})

test('lists active shows and archived shows apart, with the existing list names', async () => {
  await renderHome({
    shows: [row('a', 'Little Women'), row('b', 'American Idiot', 'archived')],
    cueCounts: { a: 12 },
  })
  const active = screen.getByRole('list', { name: 'Active shows' })
  expect(within(active).getByRole('link', { name: 'Little Women' })).toBeTruthy()
  // One column on a phone, two at tablet, three above 1024.
  expect(active.className).toContain('grid-cols-1')
  expect(active.className).toContain('md:max-[1024px]:grid-cols-2')
  expect(active.className).toContain('min-[1025px]:grid-cols-3')
  expect(within(active).queryByText('American Idiot')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Archived' })).toBeTruthy()
  const archived = screen.getByRole('list', { name: 'Archived shows' })
  expect(within(archived).getByRole('link', { name: 'American Idiot' })).toBeTruthy()
})

test('has no Archived section when nothing is archived', async () => {
  await renderHome({ shows: [row('a', 'Little Women')] })
  expect(screen.queryByRole('heading', { name: 'Archived' })).toBeNull()
  expect(screen.queryByRole('list', { name: 'Archived shows' })).toBeNull()
})

test('with no active shows it says so in one line and offers to start one', async () => {
  const { onNewShow } = await renderHome({ shows: [row('b', 'American Idiot', 'archived')] })
  expect(screen.queryByRole('list', { name: 'Active shows' })).toBeNull()
  const line = screen.getByText(/the quiet before the pad comes in/i)
  expect(line.className).toContain('font-hand')
  expect(line.className).toContain('text-ink-2')
  fireEvent.click(screen.getByRole('button', { name: 'Start a show' }))
  expect(onNewShow).toHaveBeenCalledTimes(1)
  expect(onNewShow.mock.calls[0][0]).toBe(screen.getByRole('button', { name: 'Start a show' }))
})

test('shows no empty state while the shows are still loading', async () => {
  await renderHome({ loading: true })
  expect(screen.queryByText(/quiet before/i)).toBeNull()
  expect(screen.getByText('Loading…')).toBeTruthy()
})

test('counts the shows under the greeting', async () => {
  await renderHome({
    shows: [row('a', 'Little Women'), row('c', 'Next to Normal'), row('b', 'Idiot', 'archived')],
  })
  expect(screen.getByText(/active shows/).textContent).toContain('2')
})

test('a show with no entry in the counts has no cues; no counts yet says nothing', async () => {
  await renderHome({ shows: [row('a', 'Little Women')], cueCounts: { z: 3 } })
  expect(screen.getByText('nothing placed yet')).toBeTruthy()
})

test('says nothing about cues while they are still being counted', async () => {
  await renderHome({ shows: [row('a', 'Little Women')], cueCounts: undefined })
  expect(screen.queryByText('nothing placed yet')).toBeNull()
})

test("passes each show's people and last change to its card, and none to archived ones", async () => {
  const people = [{ userId: 'u2', name: 'Mikaela', colour: '#5b8def', departments: ['LX'] }]
  const change = {
    at: '2026-10-16T11:48:00Z',
    userId: 'u2',
    label: 'Mikaela',
    summary: 'relabelled 3 LX cues',
    sentence: 'LX relabelled 3 cues',
    count: 3,
    via: 'web' as const,
    agent: null,
    batchId: 'b',
  }
  await renderHome({
    shows: [row('a', 'Little Women'), row('b', 'American Idiot', 'archived')],
    pulse: { presence: { a: { people } }, lastChanges: { a: change } },
  })
  const active = screen.getByRole('list', { name: 'Active shows' })
  expect(within(active).getByRole('img', { name: 'Mikaela, LX' })).toBeTruthy()
  expect(active.textContent).toContain('LX relabelled 3 cues')
  const archived = screen.getByRole('list', { name: 'Archived shows' })
  expect(within(archived).queryByRole('img')).toBeNull()
})

const archivedShows = () => [
  row('a', 'Little Women'),
  row('b', 'American Idiot', 'archived'),
  row('c', 'Next to Normal', 'archived'),
]

test('only an owner’s archived card offers Reactivate, and an active card never does', async () => {
  await renderHome({
    shows: archivedShows(),
    ownedShowIds: new Set(['a', 'b']),
    onReactivate: vi.fn(),
  })
  const archived = screen.getByRole('list', { name: 'Archived shows' })
  expect(within(archived).getByRole('button', { name: 'Reactivate American Idiot' })).toBeTruthy()
  expect(within(archived).queryByRole('button', { name: 'Reactivate Next to Normal' })).toBeNull()
  const active = screen.getByRole('list', { name: 'Active shows' })
  expect(within(active).queryByRole('button', { name: /^Reactivate/ })).toBeNull()
})

test('no card offers Reactivate before the memberships are known or without a handler', async () => {
  await renderHome({ shows: archivedShows(), onReactivate: vi.fn() })
  expect(screen.queryByRole('button', { name: /^Reactivate/ })).toBeNull()
  document.body.innerHTML = ''
  await renderHome({ shows: archivedShows(), ownedShowIds: new Set(['b', 'c']) })
  expect(screen.queryByRole('button', { name: /^Reactivate/ })).toBeNull()
})

test('Reactivate hands back the show’s id', async () => {
  const onReactivate = vi.fn(async () => {})
  await renderHome({ shows: archivedShows(), ownedShowIds: new Set(['c']), onReactivate })
  fireEvent.click(screen.getByRole('button', { name: 'Reactivate Next to Normal' }))
  await waitFor(() => expect(onReactivate).toHaveBeenCalledWith('c'))
})

test('a reactivated card moves up to Active and takes focus there', async () => {
  function Harness() {
    const [shows, setShows] = useState(archivedShows())
    return (
      <ShowsHome
        {...homeProps(() => {})}
        shows={shows}
        ownedShowIds={new Set(['b', 'c'])}
        // the local write: the show row changes and the page re-renders from it
        onReactivate={async (id) => {
          setShows((all) => all.map((s) => (s.id === id ? { ...s, status: 'prep' } : s)))
        }}
      />
    )
  }
  await renderInRouter(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Reactivate American Idiot' }))
  const active = screen.getByRole('list', { name: 'Active shows' })
  await waitFor(() =>
    expect(within(active).getByRole('link', { name: 'American Idiot' })).toBeTruthy(),
  )
  expect(document.activeElement).toBe(within(active).getByRole('link', { name: 'American Idiot' }))
  // the other archived show stays where it was
  const archived = screen.getByRole('list', { name: 'Archived shows' })
  expect(within(archived).getByRole('link', { name: 'Next to Normal' })).toBeTruthy()
  expect(within(archived).queryByRole('link', { name: 'American Idiot' })).toBeNull()
})

test('a Reactivate that fails leaves focus alone and the card where it was', async () => {
  const onReactivate = vi.fn(async () => {
    throw new Error('nope')
  })
  await renderHome({ shows: archivedShows(), ownedShowIds: new Set(['b']), onReactivate })
  fireEvent.click(screen.getByRole('button', { name: 'Reactivate American Idiot' }))
  await screen.findByRole('alert')
  const archived = screen.getByRole('list', { name: 'Archived shows' })
  expect(within(archived).getByRole('link', { name: 'American Idiot' })).toBeTruthy()
})
