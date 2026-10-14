import { act, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { SelectionAnnouncer } from './SelectionAnnouncer'
import { clearSelection, select } from './selection'

const cue = {
  id: 'c1',
  type: 'go',
  label: 'Sunrise',
  major: 10,
  minor: 0,
  anchor: { pageIndex: 1, x: 10, y: 10 },
  dept_code: 'LX',
  dept_colour: '#F5A623',
  dept_number_format: 'decimal',
}
const note = {
  id: 'a1',
  layer_kind: 'personal',
  layer_id: 'u1',
  anchor: { pageIndex: 0, x: 10, y: 10 },
  type: 'note',
  geometry: '{}',
  text: 'Cover the gap',
  style: '{}',
}
vi.mock('./MarkupSession', () => ({
  useMarkupSession: () => ({
    view: { ordered: [cue], annotationsByPage: new Map([[0, [note]]]) },
    layerName: (l: { kind: string }) => (l.kind === 'personal' ? 'Personal' : 'LX'),
  }),
}))

afterEach(() => act(() => clearSelection()))

test('selection changes are announced politely', () => {
  const { getByRole } = render(<SelectionAnnouncer />)
  const status = getByRole('status')
  expect(status.getAttribute('aria-live')).toBe('polite')
  expect(status.textContent).toBe('')
  act(() => select('cues', 'c1'))
  expect(status.textContent).toBe('Selected LX 10, Sunrise, page 2')
  act(() => clearSelection())
  expect(status.textContent).toBe('No cue selected')
})

test('an annotation selection is announced by its layer, type and words', () => {
  const { getByRole } = render(<SelectionAnnouncer />)
  const status = getByRole('status')
  act(() => select('annotations', 'a1'))
  expect(status.textContent).toBe('Selected Personal note: Cover the gap, page 1')
  act(() => clearSelection())
  expect(status.textContent).toBe('No annotation selected')
})

test('moving from a cue to an annotation announces the new selection', () => {
  const { getByRole } = render(<SelectionAnnouncer />)
  const status = getByRole('status')
  act(() => select('cues', 'c1'))
  act(() => select('annotations', 'a1'))
  expect(status.textContent).toBe('Selected Personal note: Cover the gap, page 1')
})
