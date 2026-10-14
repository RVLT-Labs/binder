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
vi.mock('./MarkupSession', () => ({
  useMarkupSession: () => ({ view: { ordered: [cue] } }),
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
