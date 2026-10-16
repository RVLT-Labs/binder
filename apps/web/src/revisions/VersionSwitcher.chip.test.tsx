import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { DocumentVersionRow } from '../powersync/schema'
import { VersionSwitcher } from './VersionSwitcher'

const v = (id: string, n: number, status = 'ready') =>
  ({ id, version_number: n, status, label: null }) as unknown as DocumentVersionRow

async function renderSwitcher(versions: DocumentVersionRow[], selectedId: string) {
  const root = createRootRoute({
    component: () => (
      <VersionSwitcher
        showId="s1"
        docId="d1"
        versions={versions}
        currentId="b"
        selectedId={selectedId}
        localOnly={false}
        onSelect={() => {}}
      />
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: '$' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const view = render(<RouterProvider router={router} />)
  await waitFor(() => expect(screen.getByLabelText('Version')).toBeTruthy())
  return view
}

test('the chip shows the short "v2" and a 20 px warm-grey pill, while the select keeps every option in full', async () => {
  const view = await renderSwitcher([v('a', 1), v('b', 2)], 'b')
  const select = screen.getByLabelText('Version') as HTMLSelectElement
  const chip = select.parentElement as HTMLElement
  expect(chip.className).toContain('h-5')
  expect(chip.className).toContain('bg-rep-soft')
  expect(chip.className).toContain('text-rep')
  expect(view.container.querySelector('span[aria-hidden]')?.textContent).toBe('v2')
  // what e2e (and the picker) see: full option text, and selection by value
  expect([...select.options].map((o) => o.text)).toEqual(['v1 · ready', 'v2 · ready (current)'])
  expect(select.value).toBe('b')
  expect(select.textContent).toContain('v2 · ready')
})
