import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { DocumentRows } from './DocumentList'
import type { DocumentEntry } from './documentEntries'
import type { DocumentsData } from './useDocumentEntries'

vi.mock('./UploadProvider', () => ({
  useUpload: () => ({ canUpload: true, openUpload: () => {} }),
}))

const entries: DocumentEntry[] = [
  {
    kind: 'ready',
    key: 'd1:v1',
    docId: 'd1',
    title: 'Libretto',
    docKind: 'libretto',
    version: { id: 'v1', number: 1, label: null, pageCount: 3, searchable: true },
    kept: null,
    compare: null,
  },
  {
    kind: 'processing',
    key: 'd1:v2',
    docId: 'd1',
    versionId: 'v2',
    title: 'Libretto',
    versionNumber: 2,
    currentNumber: 1,
    status: 'processing',
    progress: null,
    steps: [],
  },
  {
    kind: 'failed',
    key: 'd2:v1',
    docId: 'd2',
    versionId: 'v3',
    title: 'Blocking notes.pdf',
    versionNumber: null,
    currentNumber: null,
    reason: 'Binder could not process this file.',
    detail: null,
    isNewVersion: false,
  },
]
const data: DocumentsData = {
  loading: false,
  entries,
  thumbs: new Map([['v1', 'thumb-key']]),
  cachedVersions: new Set(),
  reviewCounts: new Map(),
}

async function renderRows(compact: boolean) {
  const root = createRootRoute({
    component: () => <DocumentRows showId="s1" data={data} compact={compact} />,
  })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: '$' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const view = render(<RouterProvider router={router} />)
  await waitFor(() => expect(view.container.innerHTML).not.toBe(''))
}

test('the overview Scripts card lists only the ready scripts, in a radius 14 card', async () => {
  await renderRows(true)
  const list = screen.getByRole('list', { name: 'Documents' })
  expect(
    within(list)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent),
  ).toEqual(['Libretto'])
  expect(list.className).toContain('rounded-[var(--r)]')
})

test('the Documents screen lists every row, and a processing version shows its document page', async () => {
  await renderRows(false)
  const list = screen.getByRole('list', { name: 'Documents' })
  expect(within(list).getAllByRole('heading', { level: 3 })).toHaveLength(3)
  // the processing row reuses the ready version's thumbnail (the first row has it too)
  expect(list.querySelectorAll('img')).toHaveLength(2)
})
