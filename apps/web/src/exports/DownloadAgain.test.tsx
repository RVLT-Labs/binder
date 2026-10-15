import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

let online = true
const isBlobCached = vi.fn()
vi.mock('../offline/useOnline', () => ({ useOnline: () => online }))
vi.mock('../blobs/fetchBlob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../blobs/fetchBlob')>()),
  isBlobCached: (...args: unknown[]) => isBlobCached(...args),
}))
const { DownloadAgain } = await import('./DownloadAgain')

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
