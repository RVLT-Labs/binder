import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu'

function menu(onSelect = vi.fn(), onCheckedChange = vi.fn(), onValueChange = vi.fn()) {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Options</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onSelect}>Run</DropdownMenuItem>
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem checked onCheckedChange={onCheckedChange}>
            Checked
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="one" onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="one">One</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="two">Two</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Nested</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem disabled onSelect={onSelect}>
          Unavailable
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

test('extra B09: every Radix row owns a coarse 44px floor and every nesting level owns 8px spacing', async () => {
  render(menu())
  for (const row of ['menuitem', 'menuitemcheckbox', 'menuitemradio'].flatMap((role) =>
    screen.getAllByRole(role),
  )) {
    expect(row.className).toContain('[@media(pointer:coarse)]:min-h-11')
    expect(row.className).toContain('[@media(pointer:coarse)]:min-w-11')
  }
  expect(screen.getByRole('menu').className).toContain('[@media(pointer:coarse)]:space-y-2')
  for (const group of screen.getAllByRole('group')) {
    expect(group.className).toContain('[@media(pointer:coarse)]:space-y-2')
  }
  const more = screen.getByRole('menuitem', { name: 'More' })
  more.focus()
  fireEvent.keyDown(more, { key: 'ArrowRight' })
  await screen.findByRole('menuitem', { name: 'Nested' })
  for (const content of screen.getAllByRole('menu')) {
    expect(content.className).toContain('[@media(pointer:coarse)]:space-y-2')
  }
})

test('extra B09: selection, check/radio roles and disabled activation remain Radix behavior', async () => {
  const select = vi.fn(),
    checked = vi.fn(),
    radio = vi.fn()
  const view = render(menu(select, checked, radio))
  const run = screen.getByRole('menuitem', { name: 'Run' })
  run.focus()
  fireEvent.keyDown(run, { key: 'Enter' })
  await waitFor(() => expect(select).toHaveBeenCalledTimes(1))
  view.unmount()
  const second = render(menu(select, checked, radio))
  const check = screen.getByRole('menuitemcheckbox', { name: 'Checked' })
  expect(check.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(check)
  expect(checked).toHaveBeenCalledWith(false)
  second.unmount()
  const third = render(menu(select, checked, radio))
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Two' }))
  expect(radio).toHaveBeenCalledWith('two')
  third.unmount()
  render(menu(select, checked, radio))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Unavailable' }))
  expect(select).toHaveBeenCalledTimes(1)
})
