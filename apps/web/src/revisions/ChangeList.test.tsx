import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ChangeList, ChangeSteps } from './ChangeList'
import type { Change, Hunk } from './compareModel'

const change = (index: number, op: 'added' | 'removed', text: string): Change => ({
  index,
  op,
  text,
  oldPage: 0,
  newPage: 0,
})
const hunk = (title: string, meta: string, changes: Change[]): Hunk => ({
  changes,
  removed: changes.filter((c) => c.op === 'removed').length,
  added: changes.filter((c) => c.op === 'added').length,
  title,
  meta,
  oldPage: 0,
  newPage: 0,
  firstIndex: changes[0].index,
})

const hunks = [
  hunk('p.9 — 2 lines cut', 'v1 p.9', [
    change(3, 'removed', 'Two and twenty'),
    change(4, 'removed', 'And the wind starts to blow'),
  ]),
  hunk('p.12 — 1 line added', 'v2 p.12', [change(9, 'added', 'A new world')]),
]

const state = { kind: 'diff', removed: 2, added: 1, hunks } as const

test('the panel names the versions and counts the changes, with the removed and added lines in words', () => {
  render(
    <ChangeList
      docTitle="Libretto"
      fromName="v1"
      toName="v2"
      state={state}
      active={null}
      onChoose={() => {}}
    />,
  )
  const nav = screen.getByRole('navigation', { name: 'Changes' })
  expect(within(nav).getByText('Libretto v1 → v2')).toBeTruthy()
  expect(within(nav).getByRole('heading', { name: 'Changes · 2' })).toBeTruthy()
  expect(within(nav).getByRole('status').textContent).toBe('2 removed, 1 added')
})

test('each hunk is a card with its title and pages, and every line is a button with its op', () => {
  render(
    <ChangeList
      docTitle="Libretto"
      fromName="v1"
      toName="v2"
      state={state}
      active={null}
      onChoose={() => {}}
    />,
  )
  expect(screen.getByRole('button', { name: /^p\.9 — 2 lines cut/ })).toBeTruthy()
  expect(screen.getByText('v1 p.9')).toBeTruthy()
  const cut = document.querySelectorAll('button.compare-change[data-op="removed"]')
  expect(cut).toHaveLength(2)
  expect(cut[0].textContent).toContain('Two and twenty')
  expect(document.querySelectorAll('button.compare-change[data-op="added"]')).toHaveLength(1)
})

test('choosing a line or a card reports its first change; the active line and its card are marked', () => {
  const onChoose = vi.fn()
  render(
    <ChangeList
      docTitle="Libretto"
      fromName="v1"
      toName="v2"
      state={state}
      active={4}
      onChoose={onChoose}
    />,
  )
  const lines = document.querySelectorAll<HTMLElement>('button.compare-change')
  expect(lines[1].getAttribute('aria-current')).toBe('true')
  expect(lines[0].getAttribute('aria-current')).toBeNull()
  const card = screen.getByRole('button', { name: /^p\.9 — 2 lines cut/ }).closest('li')
  expect(card?.getAttribute('data-active')).toBe('true')
  expect(
    screen
      .getByRole('button', { name: /^p\.12 — 1 line added/ })
      .closest('li')
      ?.getAttribute('data-active'),
  ).toBeNull()
  fireEvent.click(lines[1])
  expect(onChoose).toHaveBeenLastCalledWith(hunks[0].changes[1])
  fireEvent.click(screen.getByRole('button', { name: /^p\.12 — 1 line added/ }))
  expect(onChoose).toHaveBeenLastCalledWith(hunks[1].changes[0])
})

test('while it works, when it cannot, and when nothing differs, it says so', () => {
  const { rerender } = render(
    <ChangeList
      docTitle="Libretto"
      fromName="v1"
      toName="v2"
      state={{ kind: 'comparing' }}
      active={null}
      onChoose={() => {}}
    />,
  )
  expect(screen.getByRole('status').textContent).toBe('Comparing…')
  rerender(
    <ChangeList
      docTitle="Libretto"
      fromName="v1"
      toName="v2"
      state={{
        kind: 'message',
        role: 'alert',
        text: '2 pages have no text available offline, so the comparison is incomplete.',
      }}
      active={null}
      onChoose={() => {}}
    />,
  )
  expect(screen.getByRole('alert').textContent).toContain('incomplete')
  rerender(
    <ChangeList
      docTitle="Libretto"
      fromName="v1"
      toName="v2"
      state={{ kind: 'diff', removed: 0, added: 0, hunks: [] }}
      active={null}
      onChoose={() => {}}
    />,
  )
  expect(screen.getByText('No differences in the text.')).toBeTruthy()
})

test('Previous and Next change are disabled at the ends and when there is nothing to step to', () => {
  const onStep = vi.fn()
  const { rerender } = render(<ChangeSteps count={3} position={0} onStep={onStep} />)
  expect(
    (screen.getByRole('button', { name: /Previous change/ }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /Next change/ }))
  expect(onStep).toHaveBeenCalledWith(1)
  rerender(<ChangeSteps count={3} position={2} onStep={onStep} />)
  expect((screen.getByRole('button', { name: /Next change/ }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  fireEvent.click(screen.getByRole('button', { name: /Previous change/ }))
  expect(onStep).toHaveBeenLastCalledWith(-1)
  rerender(<ChangeSteps count={0} position={null} onStep={onStep} />)
  expect((screen.getByRole('button', { name: /Next change/ }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect(
    (screen.getByRole('button', { name: /Previous change/ }) as HTMLButtonElement).disabled,
  ).toBe(true)
})
