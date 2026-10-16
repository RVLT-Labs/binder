import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { KeepOfflineSwitch } from './KeepOfflineSwitch'
import type { ShowStatus } from './runner'
import { publishKeepOfflineStatus } from './status'
import { clearOfflinePrefs, idbOfflinePrefsStore, loadOfflinePrefs, setKeepOffline } from './store'

vi.mock('../../auth/session', () => ({
  useSessionUser: () => ({ data: { id: 'u1', email: 'a@b.c', name: 'A' } }),
}))

const SHOW = 'show-1'
const status = (s: Partial<ShowStatus>): ReadonlyMap<string, ShowStatus> =>
  new Map([[SHOW, { state: 'idle', total: 10, missing: 0, failed: 0, ...s }]])

async function renderOn(next?: ReadonlyMap<string, ShowStatus>) {
  await setKeepOffline('u1', SHOW, true)
  if (next) act(() => publishKeepOfflineStatus(next))
  return render(<KeepOfflineSwitch showId={SHOW} />)
}

beforeEach(async () => {
  await clearOfflinePrefs('u1')
  await loadOfflinePrefs('u1')
  publishKeepOfflineStatus(new Map())
})
afterEach(async () => {
  await clearOfflinePrefs('u1')
})

test('renders Off with the word, and says nothing else', () => {
  render(<KeepOfflineSwitch showId={SHOW} />)
  const toggle = screen.getByRole('switch', { name: 'Make available offline' })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText('Off')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
})

test('renders On with the word, the updating text, the offline text and the full text', async () => {
  const view = await renderOn()
  const toggle = screen.getByRole('switch', { name: 'Make available offline' })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText('On')).toBeTruthy()
  // All cached: the card's own line says so; the switch adds nothing.
  expect(screen.queryByRole('status')).toBeNull()

  act(() => publishKeepOfflineStatus(status({ state: 'working', missing: 3 })))
  expect(screen.getByRole('status').textContent).toBe('Updating 3 files…')
  const bar = screen.getByRole('progressbar')
  expect(bar.getAttribute('value')).toBe('7')
  expect(bar.getAttribute('max')).toBe('10')

  act(() => publishKeepOfflineStatus(status({ state: 'offline', missing: 3 })))
  expect(screen.getByRole('status').textContent).toBe('Waiting for a connection. 3 files to fetch.')
  expect(screen.queryByRole('progressbar')).toBeNull()

  act(() => publishKeepOfflineStatus(status({ state: 'full', missing: 3 })))
  const full = screen.getByRole('status')
  expect(full.textContent).toBe(
    'Storage is full. Binder couldn’t save 3 files. Free some space on this device.',
  )
  // The pill carries the words, never the colour alone.
  expect(within(view.container).getByText('Storage full')).toBeTruthy()

  act(() => publishKeepOfflineStatus(status({ state: 'failed', missing: 2, failed: 2 })))
  expect(screen.getByRole('status').textContent).toBe(
    '2 files couldn’t be saved. Binder will try again.',
  )

  act(() => publishKeepOfflineStatus(status({ state: 'paused', missing: 1 })))
  expect(screen.getByRole('status').textContent).toBe(
    'Paused while data saver is on. 1 file to fetch.',
  )
})

test('a status without the switch On is not shown', () => {
  // The runner clears Off shows' status; a stale one must not leak into an Off switch.
  act(() => publishKeepOfflineStatus(status({ state: 'working', missing: 3 })))
  render(<KeepOfflineSwitch showId={SHOW} />)
  expect(screen.queryByRole('status')).toBeNull()
})

test('the toggle persists the preference', async () => {
  render(<KeepOfflineSwitch showId={SHOW} />)
  const toggle = screen.getByRole('switch', { name: 'Make available offline' })
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  expect((await idbOfflinePrefsStore('u1').list()).map(([id]) => id)).toEqual([SHOW])
  expect(screen.getByText('On')).toBeTruthy()

  fireEvent.click(toggle)
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
  expect(await idbOfflinePrefsStore('u1').list()).toEqual([])
})

test('clicking the label toggles it too, so the whole row is the target', async () => {
  render(<KeepOfflineSwitch showId={SHOW} />)
  fireEvent.click(screen.getByText('Make available offline'))
  await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'))
})

test('a custom label names the switch', () => {
  render(<KeepOfflineSwitch showId={SHOW} label="Keep available offline" />)
  expect(screen.getByRole('switch', { name: 'Keep available offline' })).toBeTruthy()
})
