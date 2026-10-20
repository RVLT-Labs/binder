import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { SelectBox } from './parts'

test('B09 settings native select reserves a two-axis target on compact tablet layouts', () => {
  const change = vi.fn()
  render(
    <SelectBox aria-label="Member role" defaultValue="viewer" onChange={change}>
      <option value="viewer">Viewer</option>
      <option value="editor">Editor</option>
    </SelectBox>,
  )
  const select = screen.getByRole('combobox', { name: 'Member role' })
  expect(getComputedStyle(select).minHeight).toBe('44px')
  expect(getComputedStyle(select).minWidth).toBe('44px')
  fireEvent.change(select, { target: { value: 'editor' } })
  expect(change).toHaveBeenCalledOnce()
  expect((select as HTMLSelectElement).value).toBe('editor')
})
