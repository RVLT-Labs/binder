import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ShowRow } from '../powersync/schema'
import { ShowsHome, type ShowsHomeProps } from './ShowsHome'

const row = (id: string, title: string, status = 'active'): ShowRow =>
  ({ id, title, status, updated_at: '2026-10-16T11:00:00Z' }) as ShowRow

async function renderHome(props: Partial<ShowsHomeProps> = {}) {
  const onNewShow = vi.fn<(opener: HTMLElement) => void>()
  const root = createRootRoute({
    component: () => (
      <ShowsHome
        shows={[]}
        loading={false}
        cueCounts={{}}
        greeting="Good evening, Jayden."
        now={new Date('2026-10-16T12:00:00Z')}
        onNewShow={onNewShow}
        onRename={async () => {}}
        {...props}
      />
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: 'shows/$showId' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { name: 'Shows' })
  return { onNewShow }
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
