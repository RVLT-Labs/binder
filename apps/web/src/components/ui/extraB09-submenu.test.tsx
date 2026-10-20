import { render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const capture = vi.hoisted(() => vi.fn())
vi.mock('@radix-ui/react-dropdown-menu', async (load) => ({
  ...(await load<object>()),
  SubContent: (props: { sideOffset?: number }) => {
    capture(props.sideOffset)
    return null
  },
}))

import { DropdownMenuSubContent } from './dropdown-menu'

test('B09 submenu placement reserves the missing target gap without changing row geometry', () => {
  render(<DropdownMenuSubContent />)
  expect(capture).toHaveBeenLastCalledWith(4)
  render(<DropdownMenuSubContent sideOffset={8} />)
  expect(capture).toHaveBeenLastCalledWith(8)
})
