import { act, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { EmptyState } from './EmptyState'
import { DocsIcon } from './icons'
import { OfflineBanner, ShellOfflineBanner } from './OfflineBanner'
import { RowsSkeleton } from './ui/skeleton'

const h = vi.hoisted(() => ({ pending: 3, queried: 0 }))
vi.mock('@powersync/react', () => ({
  useQuery: () => {
    h.queried += 1
    return { data: [{ n: h.pending }] }
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  h.queried = 0
})

test('EmptyState says what is empty, in plain words, with Kalam only when it is given', () => {
  const { rerender } = render(
    <EmptyState icon={DocsIcon} heading="No documents yet.">
      Upload a script.
    </EmptyState>,
  )
  expect(screen.getByText('No documents yet.')).toBeTruthy()
  expect(screen.getByText('Upload a script.')).toBeTruthy()
  expect(document.querySelector('.font-hand')).toBeNull()
  rerender(
    <EmptyState
      heading="No sound cues yet."
      hand="the quiet before the pad comes in"
      action={<button type="button">Place the first cue</button>}
    />,
  )
  const hand = screen.getByText('the quiet before the pad comes in')
  expect(hand.className).toContain('font-hand')
  // in ink, so it does not read as an alert
  expect(hand.className).toContain('text-ink-2')
  expect(hand.className).not.toContain('text-red')
  expect(screen.getByRole('button', { name: 'Place the first cue' })).toBeTruthy()
})

test("the offline banner is a muted status with the brief's words, never an alert", () => {
  render(<OfflineBanner waiting={3} />)
  const banner = screen.getByRole('status')
  expect(banner.textContent).toBe('Offline. Changes are saved on this device — 3 waiting to sync.')
  expect(within(banner).getByText('3').className).toContain('font-mono')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(banner.className).toContain('bg-elev')
})

test('the shell banner shows only while offline, and reads the upload queue only then', () => {
  const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
  const { container } = render(<ShellOfflineBanner />)
  expect(container.textContent).toBe('')
  expect(h.queried).toBe(0)
  online.mockReturnValue(false)
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
  expect(screen.getByRole('status').textContent).toContain('3 waiting to sync')
  online.mockReturnValue(true)
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  expect(container.textContent).toBe('')
})

test('the skeleton keeps its words for a screen reader and its column widths for the eye', () => {
  const { container } = render(<RowsSkeleton />)
  expect(screen.getByText('Loading…').className).toContain('sr-only')
  const rows = container.querySelectorAll('[aria-hidden="true"]')
  expect(rows).toHaveLength(3)
  expect(rows[0]?.className).toContain('grid-cols-[52px_minmax(0,1fr)_44px]')
})
