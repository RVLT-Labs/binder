import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { installDialogPolyfill } from '../test/dialog'
import { DocumentRow } from './DocumentRow'
import type { FailedEntry, ProcessingEntry } from './documentEntries'
import { SETTLE_MS } from './useVersionActions'

const online = vi.hoisted(() => ({ value: true }))
const post = vi.hoisted(() => vi.fn())
const del = vi.hoisted(() => vi.fn())
const notices = vi.hoisted(() => vi.fn())
vi.mock('../offline/useOnline', () => ({ useOnline: () => online.value }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: { post, del },
}))
vi.mock('../components/noticeStore', () => ({ pushNotice: notices }))

beforeEach(() => {
  installDialogPolyfill()
  online.value = true
  post.mockReset().mockResolvedValue({})
  del.mockReset().mockResolvedValue({})
  notices.mockReset()
})

const processing: ProcessingEntry = {
  kind: 'processing',
  key: 'd1:v3',
  docId: 'd1',
  versionId: 'v3',
  title: 'Libretto',
  versionNumber: 3,
  currentNumber: 2,
  status: 'processing',
  progress: { ready: 16, total: 25 },
  steps: [
    { key: 'upload', label: 'Upload', state: 'done' },
    { key: 'extract', label: 'Extract text', state: 'current' },
    { key: 'layer', label: 'Build word layer', state: 'pending' },
  ],
  sizeBytes: 12_400_000,
  canCancel: true,
}
const failed = (over: Partial<FailedEntry>): FailedEntry => ({
  kind: 'failed',
  key: 'd2:v1',
  docId: 'd2',
  versionId: 'v9',
  title: 'Blocking notes.pdf',
  versionNumber: null,
  currentNumber: null,
  code: 'timeout',
  pill: 'couldn’t finish',
  reason:
    'This file took too long to process. Try again; if it keeps happening, split the PDF or upload a smaller scan.',
  detail: null,
  isNewVersion: false,
  canRetryInPlace: true,
  ...over,
})
const lowResolution = failed({
  code: 'low_resolution',
  pill: 'couldn’t read text',
  reason: 'Scanned at 72 dpi, so there is no text to search or anchor to. Try a 300 dpi scan.',
  canRetryInPlace: false,
})

async function show(entry: ProcessingEntry | FailedEntry, props: { canUpload?: boolean } = {}) {
  const onUpload = vi.fn()
  const ui: ReactElement = (
    <QueryClientProvider client={new QueryClient()}>
      <ul>
        <DocumentRow
          showId="s1"
          entry={entry}
          canUpload={props.canUpload ?? true}
          onUpload={onUpload}
        />
      </ul>
    </QueryClientProvider>
  )
  const root = createRootRoute({ component: () => ui })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: '$' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const view = render(<RouterProvider router={router} />)
  await waitFor(() => expect(view.container.innerHTML).not.toBe(''))
  return { onUpload, unmount: view.unmount, item: screen.getAllByRole('listitem')[0] }
}

test('processing row shows "12 MB uploaded" in the status line and Cancel', async () => {
  const { item } = await show(processing)
  const status = within(item).getByText(/uploaded, now extracting text/)
  expect(status.textContent).toBe('12 MB uploaded, now extracting text')
  expect(within(status).getByText('12').className).toContain('font-mono')
  expect(within(item).getByRole('button', { name: 'Cancel Libretto v3' })).toBeTruthy()
  expect(within(item).getByText('64 %')).toBeTruthy()
})

test('a queued upload says it is waiting, with its size', async () => {
  const { item } = await show({ ...processing, status: 'queued' })
  expect(item.textContent).toContain('12 MB uploaded, waiting to start')
})

test('Cancel posts to the cancel route and holds the buttons until the row flips', async () => {
  const { item } = await show(processing)
  fireEvent.click(within(item).getByRole('button', { name: 'Cancel Libretto v3' }))
  await waitFor(() => expect(post).toHaveBeenCalledWith('/shows/s1/versions/v3/cancel'))
  await waitFor(() =>
    expect(
      (within(item).getByRole('button', { name: 'Cancel Libretto v3' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  )
})

test('Cancel is absent while re-anchoring, before the row syncs, and for someone who cannot upload', async () => {
  const reanchoring = await show({ ...processing, status: 'reanchoring', canCancel: false })
  expect(within(reanchoring.item).queryByRole('button', { name: /^Cancel/ })).toBeNull()
  reanchoring.unmount()
  const unsynced = await show({ ...processing, versionId: null, canCancel: false })
  expect(within(unsynced.item).queryByRole('button', { name: /^Cancel/ })).toBeNull()
  unsynced.unmount()
  const viewer = await show(processing, { canUpload: false })
  expect(within(viewer.item).queryByRole('button', { name: /^Cancel/ })).toBeNull()
})

test('failed low_resolution row shows the mockup copy with 72 dpi in mono', async () => {
  const { item } = await show(lowResolution)
  expect(item.querySelector('.version-status')?.textContent).toBe('couldn’t read text')
  const copy = within(item).getByText(/Scanned at/)
  expect(copy.textContent).toBe(
    'Scanned at 72 dpi, so there is no text to search or anchor to. Try a 300 dpi scan.',
  )
  expect([...copy.querySelectorAll('.font-mono')].map((m) => m.textContent)).toEqual([
    '72 dpi',
    '300 dpi',
  ])
  expect(within(item).getByRole('button', { name: 'Try again, Blocking notes.pdf' })).toBeTruthy()
  expect(within(item).getByRole('button', { name: 'Remove Blocking notes.pdf' })).toBeTruthy()
})

test('Try again on a timeout calls retry; on low_resolution it opens the upload dialog', async () => {
  const first = await show(failed({}))
  fireEvent.click(within(first.item).getByRole('button', { name: 'Try again, Blocking notes.pdf' }))
  await waitFor(() => expect(post).toHaveBeenCalledWith('/shows/s1/versions/v9/retry'))
  expect(first.onUpload).not.toHaveBeenCalled()
  first.unmount()

  post.mockClear()
  const second = await show(lowResolution)
  fireEvent.click(
    within(second.item).getByRole('button', { name: 'Try again, Blocking notes.pdf' }),
  )
  expect(second.onUpload).toHaveBeenCalledWith(
    { kind: 'version', documentId: 'd2', documentTitle: 'Blocking notes.pdf' },
    expect.anything(),
  )
  expect(post).not.toHaveBeenCalled()
})

test('Remove confirms, then calls delete; declining deletes nothing', async () => {
  const { item } = await show(lowResolution)
  fireEvent.click(within(item).getByRole('button', { name: 'Remove Blocking notes.pdf' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toContain(
    'Remove Blocking notes.pdf? The file and its record go. Nothing in the script uses it.',
  )
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(del).not.toHaveBeenCalled()

  fireEvent.click(within(item).getByRole('button', { name: 'Remove Blocking notes.pdf' }))
  const again = await screen.findByRole('dialog')
  fireEvent.click(within(again).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(del).toHaveBeenCalledWith('/shows/s1/versions/v9'))
})

test('buttons are disabled offline, with the reason on the row', async () => {
  online.value = false
  const run = await show(processing)
  expect(
    (within(run.item).getByRole('button', { name: 'Cancel Libretto v3' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  expect(within(run.item).getByText('Needs a connection')).toBeTruthy()
  run.unmount()

  const bad = await show(failed({}))
  expect(
    (
      within(bad.item).getByRole('button', {
        name: 'Try again, Blocking notes.pdf',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true)
  expect(
    (
      within(bad.item).getByRole('button', {
        name: 'Remove Blocking notes.pdf',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true)
  expect(within(bad.item).getByText('Needs a connection')).toBeTruthy()
})

test('a server refusal is shown as a notice with its own sentence', async () => {
  const { ApiError } = await import('../api/client')
  post.mockRejectedValue(new ApiError(409, 'conflict', 'This upload has already finished'))
  const { item } = await show(processing)
  fireEvent.click(within(item).getByRole('button', { name: 'Cancel Libretto v3' }))
  await waitFor(() =>
    expect(notices).toHaveBeenCalledWith({
      kind: 'error',
      message: 'This upload has already finished',
    }),
  )
  // the buttons come back, so it can be tried again
  await waitFor(() =>
    expect(
      (within(item).getByRole('button', { name: 'Cancel Libretto v3' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  )
})

test('a failed row for a viewer has no buttons', async () => {
  const { item } = await show(lowResolution, { canUpload: false })
  expect(within(item).queryByRole('button')).toBeNull()
})

test('a cancelled row is quiet: no red card border and no red dot', async () => {
  const { item } = await show(
    failed({
      code: 'cancelled',
      pill: 'cancelled',
      reason: 'Cancelled. The file is still here if you want to try again.',
    }),
  )
  expect(item.className).not.toContain('--red')
  expect(item.querySelector('.version-status')?.textContent).toBe('cancelled')
  expect(item.querySelector('.version-status')?.parentElement?.className).toContain('text-rep')
  expect(within(item).getByRole('button', { name: 'Try again, Blocking notes.pdf' })).toBeTruthy()
})

test('the buttons are named for their row, and the visible word leads', async () => {
  const run = await show(processing)
  expect(within(run.item).getByRole('button', { name: 'Cancel Libretto v3' }).textContent).toBe(
    'Cancel',
  )
  run.unmount()
  const bad = await show(failed({}))
  expect(
    within(bad.item).getByRole('button', { name: 'Try again, Blocking notes.pdf' }),
  ).toBeTruthy()
  expect(within(bad.item).getByRole('button', { name: 'Remove Blocking notes.pdf' })).toBeTruthy()
})

test('an untitled document is not asked about as "Remove ?"', async () => {
  const { item } = await show(failed({ title: '' }))
  fireEvent.click(within(item).getByRole('button', { name: 'Remove document' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toContain('Remove document? The file and its record go.')
})

test('offline, the note is tied to the disabled buttons; an upload-opening Try again is enabled and not described by it', async () => {
  online.value = false
  const { item } = await show(lowResolution)
  const remove = within(item).getByRole('button', { name: 'Remove Blocking notes.pdf' })
  const note = within(item).getByText('Remove needs a connection')
  expect(remove.getAttribute('aria-describedby')).toBe(note.id)
  const tryAgain = within(item).getByRole('button', {
    name: 'Try again, Blocking notes.pdf',
  }) as HTMLButtonElement
  expect(tryAgain.disabled).toBe(false)
  expect(tryAgain.getAttribute('aria-describedby')).toBeNull()
})

/** Processing and failed rows draw no links, so they mount without a router and can be re-rendered. */
function mountRows(entries: (ProcessingEntry | FailedEntry)[]) {
  const client = new QueryClient()
  const ui = (list: (ProcessingEntry | FailedEntry)[]) => (
    <QueryClientProvider client={client}>
      <ul aria-label="Documents" tabIndex={-1}>
        {list.map((entry) => (
          <DocumentRow key={entry.key} showId="s1" entry={entry} canUpload onUpload={vi.fn()} />
        ))}
      </ul>
    </QueryClientProvider>
  )
  const view = render(ui(entries))
  return {
    list: () => screen.getByRole('list', { name: 'Documents' }),
    rerender: (next: (ProcessingEntry | FailedEntry)[]) => view.rerender(ui(next)),
  }
}

test('a removed row hands focus to the next row, or the list when it was the last', async () => {
  const a = failed({ key: 'a', versionId: 'va', title: 'First' })
  const b = failed({ key: 'b', versionId: 'vb', title: 'Second' })
  const rows = mountRows([a, b])
  const remove = screen.getByRole('button', { name: 'Remove First' })
  remove.focus()
  fireEvent.click(remove)
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(del).toHaveBeenCalledWith('/shows/s1/versions/va'))
  rows.rerender([b])
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again, Second' }))

  const last = screen.getByRole('button', { name: 'Remove Second' })
  last.focus()
  fireEvent.click(last)
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(del).toHaveBeenCalledWith('/shows/s1/versions/vb'))
  rows.rerender([])
  expect(document.activeElement).toBe(rows.list())
})

test('a successful retry holds the buttons, and lets go when the row comes back failed with a new code', async () => {
  const rows = mountRows([failed({ code: 'timeout' })])
  fireEvent.click(screen.getByRole('button', { name: 'Try again, Blocking notes.pdf' }))
  await waitFor(() => expect(post).toHaveBeenCalledWith('/shows/s1/versions/v9/retry'))
  const tryAgain = () =>
    screen.getByRole('button', { name: 'Try again, Blocking notes.pdf' }) as HTMLButtonElement
  await waitFor(() => expect(tryAgain().disabled).toBe(true))
  // sync delivers only the final state: still failed, now because it never started
  rows.rerender([failed({ code: 'enqueue_failed', pill: 'didn’t start' })])
  await waitFor(() => expect(tryAgain().disabled).toBe(false))
  expect(
    (screen.getByRole('button', { name: 'Remove Blocking notes.pdf' }) as HTMLButtonElement)
      .disabled,
  ).toBe(false)
})

test('a successful retry that comes back in the very same shape frees the buttons after a pause', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    mountRows([failed({ code: 'timeout' })])
    fireEvent.click(screen.getByRole('button', { name: 'Try again, Blocking notes.pdf' }))
    const tryAgain = () =>
      screen.getByRole('button', { name: 'Try again, Blocking notes.pdf' }) as HTMLButtonElement
    await waitFor(() => expect(tryAgain().disabled).toBe(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 100)
    })
    expect(tryAgain().disabled).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})
