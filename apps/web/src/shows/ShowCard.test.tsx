import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ShowCard, type ShowCardProps } from './ShowCard'

const NOW = new Date('2026-10-16T12:00:00Z')

const show = (over: Partial<ShowCardProps['show']> = {}): ShowCardProps['show'] => ({
  id: 's1',
  title: 'Songs for a New World',
  status: 'active',
  updated_at: '2026-10-16T11:48:00Z',
  ...over,
})

async function renderCard(props: Partial<ShowCardProps> = {}) {
  const onRename = props.onRename ?? vi.fn(async () => {})
  const root = createRootRoute({
    component: () => (
      <ul aria-label="Active shows">
        <ShowCard show={show()} cueCount={96} now={NOW} onRename={onRename} {...props} />
      </ul>
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
  await screen.findByRole('list', { name: 'Active shows' })
  return { onRename }
}

test('the title is a link to the show, and its name is the title alone', async () => {
  await renderCard()
  const link = screen.getByRole('link', { name: 'Songs for a New World' })
  expect(link.getAttribute('href')).toBe('/shows/s1')
})

test('an active show wears an Active pill, its cue count and when it last changed', async () => {
  await renderCard()
  const card = screen.getByRole('listitem')
  expect(within(card).getByText('Active')).toBeTruthy()
  expect(card.textContent).toContain('96')
  expect(card.textContent).toContain('cues')
  expect(card.textContent).toContain('12 min ago')
  expect(within(card).queryByText(/read-only/)).toBeNull()
})

test('says so when nothing is placed yet', async () => {
  await renderCard({ cueCount: 0 })
  expect(screen.getByRole('listitem').textContent).toContain('nothing placed yet')
})

test('one cue reads as one cue', async () => {
  await renderCard({ cueCount: 1 })
  expect(screen.getByRole('listitem').textContent).toMatch(/1\s*cue(?!s)/)
})

test('an archived show wears an Archived pill and says read-only, with a dashed card', async () => {
  await renderCard({ show: show({ status: 'archived' }) })
  const card = screen.getByRole('listitem')
  expect(within(card).getByText('Archived')).toBeTruthy()
  expect(within(card).getByText('read-only')).toBeTruthy()
  expect(card.className).toContain('border-dashed')
  expect(within(card).queryByText('Active')).toBeNull()
})

test('shows nothing about cues until the count is known', async () => {
  await renderCard({ cueCount: undefined })
  expect(screen.getByRole('listitem').textContent).not.toContain('cue')
})

test('Rename opens the title field, Save hands back the trimmed title', async () => {
  const { onRename } = await renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Rename Songs for a New World' }))
  const field = screen.getByLabelText('Show title') as HTMLInputElement
  expect(field.value).toBe('Songs for a New World')
  fireEvent.change(field, { target: { value: '  Songs, again  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onRename).toHaveBeenCalledWith('Songs, again')
  // The title is back as a link; the field is gone.
  expect(screen.queryByLabelText('Show title')).toBeNull()
  expect(screen.getByRole('link', { name: 'Songs for a New World' })).toBeTruthy()
})

test('Cancel, an empty title and an unchanged title rename nothing', async () => {
  const { onRename } = await renderCard()
  const rename = () => fireEvent.click(screen.getByRole('button', { name: /^Rename / }))
  rename()
  fireEvent.change(screen.getByLabelText('Show title'), { target: { value: 'Other' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  rename()
  fireEvent.change(screen.getByLabelText('Show title'), { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  rename()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onRename).not.toHaveBeenCalled()
})

test('a long title wraps inside the card instead of widening it', async () => {
  await renderCard({ show: show({ title: 'A'.repeat(60) }) })
  const link = screen.getByRole('link', { name: 'A'.repeat(60) })
  expect(link.className).toContain('[overflow-wrap:anywhere]')
})
