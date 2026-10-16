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

test('lists its documents with their current version, then the cue count, then a review flag', async () => {
  await renderCard({
    documents: [
      { title: 'Libretto', version: 2 },
      { title: 'Piano-vocal', version: 1 },
    ],
    cueCount: 96,
    toReview: 4,
  })
  const text = screen.getByRole('listitem').textContent ?? ''
  expect(text).toContain('Libretto v2')
  expect(text).toContain('Piano-vocal v1')
  expect(text).toContain('96 cues')
  expect(text).toContain('4 to review')
})

test('no review flag when nothing is waiting', async () => {
  await renderCard({ toReview: 0 })
  expect(screen.getByRole('listitem').textContent).not.toContain('to review')
})

test('an empty show with a script says so in a red Kalam chip, without one it just says nothing is placed', async () => {
  await renderCard({ cueCount: 0, documents: [{ title: 'Libretto', version: 1 }] })
  const chip = screen.getByText('script in, nothing placed yet')
  expect(chip.className).toContain('font-hand')
  expect(chip.className).toContain('text-red')
  expect(chip.className).toContain('text-[15px]')
  expect(screen.getByRole('listitem').textContent).toContain('0 cues')
})

test('an archived card is the dimmed dashed card that says exports still work', async () => {
  await renderCard({ show: show({ status: 'archived' }) })
  const card = screen.getByRole('listitem')
  expect(card.className).toContain('opacity-75')
  expect(card.className).toContain('bg-card')
  expect(within(card).getByText('exports still work')).toBeTruthy()
})

const MIKAELA = { userId: 'u2', name: 'Mikaela', colour: '#5b8def', detail: 'LX' }
const JAYDEN = { userId: 'u1', name: 'Jayden', colour: '#f0a93a' }
const CHANGE = {
  at: '2026-10-16T11:48:00Z',
  label: 'Mikaela',
  summary: 'relabelled 3 LX cues',
  sentence: 'LX relabelled 3 cues',
}

test('shows avatars and the sentence with relative time', async () => {
  await renderCard({ inNow: [JAYDEN, MIKAELA], lastChange: CHANGE })
  const card = screen.getByRole('listitem')
  const group = within(card).getByRole('group', { name: 'In the show now' })
  // the viewer's own avatar is drawn like anyone's; the tooltip names the department scope
  expect(within(group).getByRole('img', { name: 'Jayden' })).toBeTruthy()
  expect(within(group).getByRole('img', { name: 'Mikaela, LX' }).getAttribute('title')).toBe(
    'Mikaela, LX',
  )
  expect(card.textContent).toContain('LX relabelled 3 cues')
  expect(card.textContent).toContain('12 min ago')
  expect(card.textContent).not.toContain('Updated')
  // the tooltip and the accessible name say who did it
  expect(within(card).getByTitle('Mikaela relabelled 3 LX cues')).toBeTruthy()
  expect(
    within(card).getByText(/Mikaela relabelled 3 LX cues/, { selector: '.sr-only' }),
  ).toBeTruthy()
  // the title link's name is still the title alone
  expect(screen.getByRole('link', { name: 'Songs for a New World' })).toBeTruthy()
})

test('more than three people collapse into +n', async () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...JAYDEN, userId: id, name: `P ${id}` }))
  await renderCard({ inNow: many, lastChange: CHANGE })
  const group = screen.getByRole('group', { name: 'In the show now' })
  expect(within(group).getAllByRole('img')).toHaveLength(4)
  expect(within(group).getByRole('img', { name: '2 more in the show' }).textContent).toBe('+2')
})

test('offline falls back to Updated from local rows and shows no avatars', async () => {
  // offline the page passes neither presence nor a last change
  await renderCard({
    show: show({ updated_at: '2026-10-15T09:00:00Z' }),
    localActivityAt: '2026-10-16T11:30:00Z',
  })
  const card = screen.getByRole('listitem')
  expect(within(card).queryByRole('group', { name: 'In the show now' })).toBeNull()
  expect(card.textContent).toContain('Updated')
  // the newest local row, not the show row's own older update
  expect(card.textContent).toContain('30 min ago')
})

test('a show without a last change also falls back to Updated', async () => {
  await renderCard({ inNow: [MIKAELA], lastChange: null })
  const card = screen.getByRole('listitem')
  expect(card.textContent).toContain('Updated')
  expect(card.textContent).toContain('12 min ago')
  expect(within(card).getByRole('group', { name: 'In the show now' })).toBeTruthy()
})

test('archived card has neither', async () => {
  await renderCard({
    show: show({ status: 'archived' }),
    inNow: [MIKAELA],
    lastChange: CHANGE,
  })
  const card = screen.getByRole('listitem')
  expect(within(card).queryByRole('group', { name: 'In the show now' })).toBeNull()
  expect(card.textContent).not.toContain('relabelled')
  expect(card.textContent).not.toContain('Updated')
})

test('the foot holds its height so data arriving moves nothing', async () => {
  await renderCard({})
  const foot = screen.getByRole('listitem').querySelector('.mt-auto')
  expect(foot?.className).toContain('min-h-6')
})

test('a long sentence gives way (basis 0, truncated) before the avatars wrap under it', async () => {
  const sentence = `${'LX relabelled and renumbered a very long run of cues, '.repeat(4)}in Act Two`
  await renderCard({ inNow: [JAYDEN, MIKAELA], lastChange: { ...CHANGE, sentence } })
  const card = screen.getByRole('listitem')
  const foot = card.querySelector('.show-card-foot')
  expect(foot?.className).toContain('flex-nowrap')
  expect(foot?.className).not.toContain('flex-wrap')
  const line = within(card).getByTitle('Mikaela relabelled 3 LX cues')
  for (const token of ['flex-1', 'basis-0', 'min-w-0']) expect(line.className).toContain(token)
  expect(within(card).getByText(sentence).className).toContain('truncate')
})

test('beside the empty-show chip the sentence takes its own line, so it reads whole', async () => {
  const sentence = 'added 1 member'
  await renderCard({ cueCount: 0, lastChange: { ...CHANGE, sentence } })
  const line = within(screen.getByRole('listitem')).getByTitle('Mikaela relabelled 3 LX cues')
  expect(line.className).toContain('basis-full')
  expect(line.className).not.toContain('basis-0')
})

test('with no avatars the foot may wrap, and so may the empty-show chip beside the sentence', async () => {
  await renderCard({ lastChange: CHANGE })
  expect(screen.getByRole('listitem').querySelector('.show-card-foot')?.className).toContain(
    'flex-wrap',
  )
})
