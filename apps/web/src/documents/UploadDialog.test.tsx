import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { UploadDialog } from './UploadDialog'

/** Records what the dialog sends and lets each test answer as the server. */
class FakeXhr {
  static last: FakeXhr
  method = ''
  url = ''
  withCredentials = false
  status = 0
  responseText = ''
  body: FormData | null = null
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  aborted = false
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  send(body: FormData) {
    this.body = body
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }
}

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  // jsdom does not implement modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
})

const pdf = new File(['%PDF-1.7 ...'], 'Pirates Libretto.pdf', { type: 'application/pdf' })

function chooseFile() {
  fireEvent.change(screen.getByLabelText('PDF file'), { target: { files: [pdf] } })
}

test('posts the text fields before the file, with credentials, and closes on success', async () => {
  const onClose = vi.fn()
  render(<UploadDialog showId="s1" target={{ kind: 'document' }} onClose={onClose} />)
  chooseFile()
  expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Pirates Libretto')
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'score' } })
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

  const xhr = FakeXhr.last
  expect([xhr.method, xhr.url, xhr.withCredentials]).toEqual([
    'POST',
    '/api/shows/s1/documents',
    true,
  ])
  expect([...(xhr.body as FormData).keys()]).toEqual(['kind', 'title', 'ocrMode', 'file'])
  expect((xhr.body as FormData).get('kind')).toBe('score')

  act(() =>
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 } as ProgressEvent),
  )
  expect(screen.getByLabelText('Upload progress')).toHaveProperty('value', 0.25)

  await act(async () => xhr.respond(201, { document: {}, version: {} }))
  expect(onClose).toHaveBeenCalledOnce()
})

test("shows the server's message when the upload is refused", async () => {
  const onClose = vi.fn()
  render(<UploadDialog showId="s1" target={{ kind: 'document' }} onClose={onClose} />)
  chooseFile()
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
  await act(async () =>
    FakeXhr.last.respond(400, { error: 'invalid', message: 'File is not a PDF' }),
  )
  expect(screen.getByRole('alert').textContent).toBe('File is not a PDF')
  expect(onClose).not.toHaveBeenCalled()
  // The form is usable again for another try.
  expect(screen.getByRole('button', { name: 'Upload' })).toHaveProperty('disabled', false)
})

test('a new version posts its label to the versions route', () => {
  render(
    <UploadDialog
      showId="s1"
      target={{ kind: 'version', documentId: 'd1', documentTitle: 'Libretto' }}
      onClose={() => {}}
    />,
  )
  expect(screen.getByRole('heading').textContent).toBe('New version of Libretto')
  chooseFile()
  fireEvent.change(screen.getByLabelText('Version label'), { target: { value: 'V5 cuts' } })
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
  expect(FakeXhr.last.url).toBe('/api/shows/s1/documents/d1/versions')
  expect([...(FakeXhr.last.body as FormData).entries()].map(([k]) => k)).toEqual(['label', 'file'])
})

test('closing the dialog mid-upload aborts the request', () => {
  const { unmount } = render(
    <UploadDialog showId="s1" target={{ kind: 'document' }} onClose={() => {}} />,
  )
  chooseFile()
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
  unmount()
  expect(FakeXhr.last.aborted).toBe(true)
})
