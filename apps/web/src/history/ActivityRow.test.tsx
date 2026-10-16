import type { ActivityGroup } from '@binder/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ActivityRow, revertLabel } from './ActivityRow'

const group = (over: Partial<ActivityGroup> = {}): ActivityGroup => ({
  batchId: 'b1',
  userId: 'u1',
  label: 'Oli',
  summary: 'placed 6 SND cues and relabelled 1',
  at: '2026-10-16T14:02:00.000Z',
  fromSeq: 10,
  toSeq: 15,
  count: 6,
  via: 'web',
  agent: null,
  ...over,
})

const renderRow = (g: ActivityGroup, props: Partial<Parameters<typeof ActivityRow>[0]> = {}) =>
  render(
    <ul>
      <ActivityRow group={g} describedBy="d" disabled={false} onRevert={() => {}} {...props} />
    </ul>,
  )

test('a row reads as a sentence: the actor in bold, then what they did', () => {
  const { container } = renderRow(group())
  const row = container.querySelector('.activity-row') as HTMLElement
  expect(row.getAttribute('data-seq')).toBe('15')
  const sentence = row.querySelector('.activity-text') as HTMLElement
  expect(sentence.textContent).toBe('Oli placed 6 SND cues and relabelled 1')
  expect(sentence.querySelector('b')?.textContent).toBe('Oli')
  expect(sentence.querySelector('.activity-via')).toBeNull()
})

test('an agent row says "via Claude Code" in purple after the person', () => {
  const { container } = renderRow(
    group({
      label: 'Jayden via Claude Code',
      agent: 'claude-code/2.1',
      via: 'mcp',
      summary: 'placed 42 LX cues',
      count: 42,
    }),
  )
  const sentence = container.querySelector('.activity-text') as HTMLElement
  expect(sentence.textContent).toBe('Jayden via Claude Code placed 42 LX cues')
  expect(sentence.querySelector('b')?.textContent).toBe('Jayden')
  const via = sentence.querySelector('.activity-via') as HTMLElement
  expect(via.textContent).toBe('via Claude Code')
  expect(via.className).toContain('text-purple')
})

test('the meta line counts the rows, and says when an agent made the batch', () => {
  const { container, rerender } = renderRow(group({ count: 1 }))
  expect(container.querySelector('.activity-meta')?.textContent).toBe('1 row')
  rerender(
    <ul>
      <ActivityRow
        group={group({ count: 42, via: 'mcp', agent: 'claude-code/2' })}
        describedBy="d"
        disabled={false}
        onRevert={() => {}}
      />
    </ul>,
  )
  expect(container.querySelector('.activity-meta')?.textContent).toBe('42 rows · agent batch')
})

test('the time is a mono, tabular <time> with the full timestamp', () => {
  const { container } = renderRow(group())
  const time = container.querySelector('time') as HTMLTimeElement
  expect(time.getAttribute('datetime')).toBe('2026-10-16T14:02:00.000Z')
  expect(time.className).toContain('font-mono')
  expect(time.className).toContain('tabular-nums')
  expect(time.textContent).toMatch(/^\d\d:\d\d$/)
})

test('Revert says how many rows above ten', () => {
  expect(revertLabel(1)).toBe('Revert')
  expect(revertLabel(10)).toBe('Revert')
  expect(revertLabel(11)).toBe('Revert 11 rows…')
  expect(revertLabel(42)).toBe('Revert 42 rows…')
  renderRow(group({ count: 42 }))
  expect(screen.getByRole('button', { name: 'Revert 42 rows…' })).toBeTruthy()
})

test('Revert calls back, and is disabled with the reason described', () => {
  const onRevert = vi.fn()
  const { rerender } = renderRow(group(), { onRevert })
  fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
  expect(onRevert).toHaveBeenCalledTimes(1)
  rerender(
    <ul>
      <ActivityRow group={group()} describedBy="why" disabled onRevert={onRevert} />
    </ul>,
  )
  const button = screen.getByRole('button', { name: 'Revert' })
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(button.getAttribute('aria-describedby')).toContain('why')
})

test("Binder's own rows get the muted initial, and a person's get their colour", () => {
  const { container, rerender } = renderRow(group({ label: 'Binder' }))
  const system = container.querySelector('.activity-avatar') as HTMLElement
  expect(system.textContent).toBe('B')
  expect(system.className).toContain('bg-elev')
  rerender(
    <ul>
      <ActivityRow group={group()} describedBy="d" disabled={false} onRevert={() => {}} />
    </ul>,
  )
  const person = container.querySelector('.activity-avatar') as HTMLElement
  expect(person.textContent).toBe('O')
  expect(within(person).queryByText('O')).toBeTruthy()
  expect(person.className).not.toContain('bg-elev')
})
