import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { AccountMenu } from './AccountMenu'

test('extra B09: account rows cannot shrink the coarse primitive; Sign out still uses the supplied callback', async () => {
  const signOut = vi.fn(async () => {})
  const root = createRootRoute({
    component: () => (
      <AccountMenu
        account={{ name: 'Fixture person', email: 'fixture@example.invalid', signOut }}
        showId="fixture"
      />
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  const trigger = await screen.findByRole('button', { name: 'Account menu' })
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const rows = await screen.findAllByRole('menuitem')
  expect(rows).toHaveLength(3)
  for (const row of rows) {
    expect(row.className).not.toContain('md:min-h-8')
    expect(row.className).toContain('md:[@media(pointer:fine)]:min-h-8')
  }
  expect(screen.getByRole('menuitem', { name: 'Settings' }).getAttribute('href')).toBe(
    '/shows/fixture/settings',
  )
  expect(
    screen.getByRole('menuitem', { name: 'Personal access tokens' }).getAttribute('href'),
  ).toBe('/settings/tokens')
  const out = screen.getByRole('menuitem', { name: 'Sign out' })
  out.focus()
  fireEvent.keyDown(out, { key: 'Enter' })
  await waitFor(() => expect(signOut).toHaveBeenCalledWith(expect.any(Function)))
})
