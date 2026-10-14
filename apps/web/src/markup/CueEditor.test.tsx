import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CueEditor } from './CueEditor'
import { updateCue } from './mutations'

const row = {
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
  const type = getByLabelText('Type') as HTMLSelectElement
  type.focus()
  const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    type.dispatchEvent(escapeKey)
  })
  expect(escapeKey.defaultPrevented).toBe(true)
  expect(document.activeElement).not.toBe(type)
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
