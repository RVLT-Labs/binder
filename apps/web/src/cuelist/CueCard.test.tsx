import type { CueListRow } from '@binder/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CueCard, CueCardList } from './CueCard'

const row = (over: Partial<CueListRow> = {}): CueListRow => ({
  id: 'c1',
  display: '2.20',
  type: 'go',
  label: 'Verse 2 swell',
  page: 'p.1',
  documentTitle: '',
  trigger: 'And the road will end',
  notes: '',
  flags: [],
  placed: true,
  anchor: { documentId: 'd', documentVersionId: 'v', pageIndex: 0, x: 1, y: 2, status: 'ok' },
  ...over,
})

test('a card is a button named by the cue number and label, with the type, page and trigger shown', () => {
  render(<CueCard cue={row()} selected={false} onSelect={() => {}} />)
  const card = screen.getByRole('button', { name: '2.20 Verse 2 swell' })
  expect(card.textContent).toContain('go')
  expect(card.textContent).toContain('p.1')
  expect(card.textContent).toContain('And the road will end')
  expect(card.getAttribute('data-cue-id')).toBe('c1')
})

test('the number is mono, tabular and 22 px; the trigger is mono', () => {
  render(<CueCard cue={row()} selected={false} onSelect={() => {}} />)
  const card = screen.getByRole('button', { name: /2\.20/ })
  const number = within(card).getByText('2.20')
  expect(number.className).toContain('font-mono')
  expect(number.className).toContain('tabular-nums')
  expect(number.className).toContain('text-[22px]')
  expect(card.querySelector('.cue-trigger')?.className).toContain('font-mono')
})

test('tapping a card selects it; the selected card says so and wears the red outline', () => {
  const onSelect = vi.fn()
  const { rerender } = render(<CueCard cue={row()} selected={false} onSelect={onSelect} />)
  const card = screen.getByRole('button', { name: /2\.20/ })
  expect(card.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(card)
  expect(onSelect).toHaveBeenCalledTimes(1)
  rerender(<CueCard cue={row()} selected onSelect={onSelect} />)
  expect(screen.getByRole('button', { name: /2\.20/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: /2\.20/ }).className).toContain('border-red')
})

test('flags are pills with words, still carrying badge[data-flag]', () => {
  const { container } = render(
    <CueCard
      cue={row({ flags: ['duplicate', 'approximate', 'unresolved'] })}
      selected={false}
      onSelect={() => {}}
    />,
  )
  const flags = [...container.querySelectorAll('.badge[data-flag]')]
  expect(flags.map((f) => [f.getAttribute('data-flag'), f.textContent])).toEqual([
    ['duplicate', 'duplicate'],
    ['approximate', 'approx.'],
    ['unresolved', 'unresolved'],
  ])
})

test('an unplaced cue has no page and a dash for a trigger, and an empty label reads as no label', () => {
  render(
    <CueCard
      cue={row({ placed: false, anchor: null, page: '—', trigger: '', label: '' })}
      selected={false}
      onSelect={() => {}}
    />,
  )
  expect(screen.getByRole('button', { name: '2.20 no label' })).toBeTruthy()
})

test('the list is a list of cards', () => {
  render(
    <CueCardList
      rows={[row(), row({ id: 'c2', display: '2.30', label: 'Woman 2 in' })]}
      selectedId="c2"
      onSelect={() => {}}
    />,
  )
  const list = screen.getByRole('list', { name: 'Cues' })
  const buttons = within(list).getAllByRole('button')
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
    '2.20 Verse 2 swell',
    '2.30 Woman 2 in',
  ])
  expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
})
