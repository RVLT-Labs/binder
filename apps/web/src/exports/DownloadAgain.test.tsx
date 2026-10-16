import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

let online = true
const isBlobCached = vi.fn()
vi.mock('../offline/useOnline', () => ({ useOnline: () => online }))
vi.mock('../blobs/fetchBlob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../blobs/fetchBlob')>()),
  isBlobCached: (...args: unknown[]) => isBlobCached(...args),
}))
const { DownloadAgain, DownloadLocal } = await import('./DownloadAgain')

const KEY = 'shows/s1/exports/e1/n1.pdf'

beforeEach(() => {
  online = true
  isBlobCached.mockReset().mockResolvedValue(false)
})

test('online: a download link for the stored file', () => {
  render(<DownloadAgain fileKey={KEY} filename="Show - Script.pdf" />)
  const link = screen.getByRole('link', { name: 'Download again' })
  expect(link.getAttribute('href')).toBe('/blobs/shows/s1/exports/e1/n1.pdf')
  expect(link.getAttribute('download')).toBe('Show - Script.pdf')
})

test('offline and not stored here: disabled, with the reason in view', async () => {
  online = false
  render(<DownloadAgain fileKey={KEY} filename="x.pdf" />)
  const button = screen.getByRole('button', { name: 'Download again' })
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Available when online')).toBeTruthy()
  expect(screen.queryByRole('link')).toBeNull()
})

test('offline but already stored: still a working link', async () => {
  online = false
  isBlobCached.mockResolvedValue(true)
  render(<DownloadAgain fileKey={KEY} filename="x.pdf" />)
  expect(await screen.findByRole('link', { name: 'Download again' })).toBeTruthy()
  expect(screen.queryByText('Available when online')).toBeNull()
})

test('a waiting export downloads from its held bytes, and the link stays live under StrictMode', () => {
  const made: string[] = []
  const revoked: string[] = []
  let n = 0
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      const u = `blob:held-${++n}`
      made.push(u)
      return u
    },
    revokeObjectURL: (u: string) => revoked.push(u),
  })
  const { unmount } = render(
    <StrictMode>
      <DownloadLocal
        bytes={new Uint8Array([1, 2])}
        contentType="application/pdf"
        filename="a.pdf"
      />
    </StrictMode>,
  )
  const link = screen.getByRole('link', { name: 'Download again' })
  // the dev double-run revoked the first URL and made another: the link points at the live one
  expect(revoked).toContain(made[0])
  expect(link.getAttribute('href')).toBe(made[made.length - 1])
  expect(revoked).not.toContain(made[made.length - 1])
  expect(link.getAttribute('download')).toBe('a.pdf')
  unmount()
  expect(revoked).toContain(made[made.length - 1])
})
