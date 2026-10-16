import { act, fireEvent, render, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CueEditor } from './CueEditor'
import { updateCue } from './mutations'

const row: Record<string, unknown> = {
  id: 'c1',
  department_id: 'lx',
  major: 10,
  minor: 0,
  label: 'Sunrise',
  type: 'go',
  notes: '',
  colour: null,
  anchor: null,
}
vi.mock('@powersync/react', () => ({
  usePowerSync: () => ({}),
  useQuery: () => ({ data: [row] }),
}))
vi.mock('./MarkupSession', () => ({
  useMarkupSession: () => ({
    departments: [{ id: 'lx', code: 'LX', name: 'Lighting', number_format: 'decimal' }],
    editable: [{ kind: 'department', id: 'lx' }],
    whyCantEdit: () => null,
    editContext: () => ({ showId: 's', userId: 'u', scope: { role: 'owner', departments: [] } }),
    removeCue: vi.fn(),
  }),
}))
vi.mock('./mutations', async (original) => ({
  ...(await original<typeof import('./mutations')>()),
  updateCue: vi.fn(async () => {}),
}))

afterEach(() => vi.clearAllMocks())

test('Escape in a text field cancels the edit and leaves the selection alone', () => {
  const { getByLabelText } = render(<CueEditor cueId="c1" />)
  const label = getByLabelText('Label') as HTMLInputElement
  label.focus()
  fireEvent.change(label, { target: { value: 'Sunset' } })
  const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    label.dispatchEvent(escapeKey)
  })
  // Handled here: the viewer's Escape-deselects shortcut sees it as already dealt with.
  expect(escapeKey.defaultPrevented).toBe(true)
  expect(label.value).toBe('Sunrise')
  expect(document.activeElement).not.toBe(label)
  expect(updateCue).not.toHaveBeenCalled()
})

test('Escape in a choice blurs it without deselecting', () => {
  const { getByLabelText } = render(<CueEditor cueId="c1" />)
  const layer = getByLabelText('Layer') as HTMLSelectElement
  layer.focus()
  const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    layer.dispatchEvent(escapeKey)
  })
  expect(escapeKey.defaultPrevented).toBe(true)
  expect(document.activeElement).not.toBe(layer)
})

test('Type is a segmented control with Go, Standby and Warn, and choosing one saves at once', () => {
  const { getByRole } = render(<CueEditor cueId="c1" />)
  const type = getByRole('radiogroup', { name: 'Type' })
  expect(
    within(type)
      .getAllByRole('radio')
      .map((r) => r.textContent),
  ).toEqual(['Go', 'Standby', 'Warn'])
  expect(within(type).getByRole('radio', { name: 'Go' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(within(type).getByRole('radio', { name: 'Warn' }))
  expect(updateCue).toHaveBeenCalledWith({}, expect.anything(), 'c1', { type: 'warn' })
})

test('the head is the department swatch, its code, the number in mono and the anchor state', () => {
  const { getByRole } = render(<CueEditor cueId="c1" />)
  const heading = getByRole('heading')
  expect(heading.textContent).toBe('LX 10')
  expect(heading.querySelector('.font-mono')?.textContent).toBe('10')
  expect(getByRole('region', { name: 'Cue editor' }).textContent).toContain('ok')
})

test('Trigger shows the words the cue sits on and their page', () => {
  row.anchor = {
    documentId: 'd',
    documentVersionId: 'v',
    pageIndex: 2,
    x: 1,
    y: 2,
    status: 'ok',
    text: { quote: 'A new world calls', wordStart: 0, wordEnd: 3 },
  } as never
  const { getByText } = render(<CueEditor cueId="c1" />)
  const quote = getByText(/A new world calls/)
  expect(quote.textContent).toContain('p.3')
  expect(quote.className).toContain('font-mono')
  row.anchor = null
})

test('Delete is plain and named Delete cue; Done (phone) is drawn only when the panel supplies it', () => {
  const onDone = vi.fn()
  const { getByRole, queryByRole, rerender } = render(<CueEditor cueId="c1" />)
  expect(getByRole('button', { name: 'Delete cue' }).textContent).toBe('Delete')
  expect(queryByRole('button', { name: 'Done' })).toBeNull()
  rerender(<CueEditor cueId="c1" onDone={onDone} />)
  fireEvent.click(getByRole('button', { name: 'Done' }))
  expect(onDone).toHaveBeenCalledTimes(1)
})

test('a field still commits on Enter', () => {
  const { getByLabelText } = render(<CueEditor cueId="c1" />)
  const label = getByLabelText('Label') as HTMLInputElement
  label.focus()
  fireEvent.change(label, { target: { value: 'Sunset' } })
  fireEvent.keyDown(label, { key: 'Enter' })
  expect(updateCue).toHaveBeenCalledWith({}, expect.anything(), 'c1', { label: 'Sunset' })
})

test('Escape in the Number field clears a stale error as it restores the stored value', () => {
  const { getByLabelText, queryByRole } = render(<CueEditor cueId="c1" />)
  const number = getByLabelText('Number') as HTMLInputElement
  number.focus()
  fireEvent.change(number, { target: { value: 'ten' } })
  fireEvent.blur(number)
  expect(queryByRole('alert')?.textContent).toMatch(/Cue numbers look like/)
  // Back in the field with the bad draft still there, Escape abandons it.
  number.focus()
  const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    number.dispatchEvent(escapeKey)
  })
  expect(number.value).toBe('10')
  expect(queryByRole('alert')).toBeNull()
  expect(updateCue).not.toHaveBeenCalled()
})
