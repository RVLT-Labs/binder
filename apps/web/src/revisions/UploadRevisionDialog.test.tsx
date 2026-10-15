import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  post: vi.fn(),
  abort: vi.fn(),
  guard: vi.fn(),
}))
vi.mock('@powersync/react', () => ({ useQuery: () => ({ data: [] }) }))
vi.mock('../documents/UploadDialog', () => ({
  MAX_UPLOAD_BYTES: 1e9,
  PROXY_LIMIT_MESSAGE: 'too big',
  postWithProgress: (...args: unknown[]) => h.post(...args),
}))
vi.mock('./useUploadGuard', () => ({
  LEAVE_UPLOAD_QUESTION: 'The upload is still running. Stop it and leave?',
  useUploadGuard: (active: boolean) => h.guard(active),
}))

import { NO_VERSION_MESSAGE, UploadRevisionDialog } from './UploadRevisionDialog'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  h.post.mockReset()
  h.abort.mockReset()
  h.guard.mockReset()
})
afterEach(() => vi.restoreAllMocks())

function pick(onClose = vi.fn()) {
  render(
    <UploadRevisionDialog
      showId="s"
      documentId="d"
      documentTitle="Script"
      onClose={onClose}
      onReanchored={() => {}}
    />,
  )
  fireEvent.change(screen.getByLabelText('PDF file'), {
    target: { files: [new File(['x'], 'v2.pdf', { type: 'application/pdf' })] },
  })
  fireEvent.change(screen.getByLabelText('Version label'), { target: { value: 'V2' } })
  return onClose
}

test('a response without a version id is an error, not a silent close', async () => {
  h.post.mockReturnValue({ promise: Promise.resolve({}), abort: h.abort })
  const onClose = pick()
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(NO_VERSION_MESSAGE))
  expect(onClose).not.toHaveBeenCalled()
  // The upload happened: a second one would make a duplicate version.
  expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(true)
})

test('closing mid-upload asks first; declining keeps the upload, accepting stops it', () => {
  h.post.mockReturnValue({ promise: new Promise(() => {}), abort: h.abort })
  const onClose = pick()
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
  expect(h.guard).toHaveBeenLastCalledWith(true)

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(h.abort).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()

  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(h.abort).toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledOnce()
})

test('closing before anything is uploading does not ask', () => {
  const confirm = vi.spyOn(window, 'confirm')
  const onClose = pick()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(confirm).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledOnce()
})
