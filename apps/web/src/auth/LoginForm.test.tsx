import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { fetchAuthCapabilities } from './capabilities'
import { LoginForm } from './LoginForm'

vi.mock('./client', () => ({ authClient: { signIn: { email: vi.fn(), magicLink: vi.fn() } } }))

const get = vi.fn()
vi.mock('../api/client', async (orig) => ({
  ...(await orig<typeof import('../api/client')>()),
  api: { get: (...args: unknown[]) => get(...args) },
}))

beforeEach(() => get.mockReset())

test('offers the magic link when the server can send one', () => {
  render(<LoginForm magicLink onSignedIn={async () => {}} />)
  expect(screen.getByRole('button', { name: 'Email me a link instead' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

test('hides the magic link when the server cannot send one', () => {
  render(<LoginForm magicLink={false} onSignedIn={async () => {}} />)
  expect(screen.queryByRole('button', { name: 'Email me a link instead' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

test('fetchAuthCapabilities reads the flag from /api/health', async () => {
  get.mockResolvedValueOnce({ ok: true, magicLink: true })
  expect(await fetchAuthCapabilities()).toEqual({ magicLink: true })
  expect(get).toHaveBeenCalledWith('/health')
  get.mockResolvedValueOnce({ ok: true, magicLink: false })
  expect(await fetchAuthCapabilities()).toEqual({ magicLink: false })
})

test('fetchAuthCapabilities hides the magic link when the server does not say it is on', async () => {
  get.mockResolvedValueOnce({ ok: true })
  expect(await fetchAuthCapabilities()).toEqual({ magicLink: false })
  get.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  expect(await fetchAuthCapabilities()).toEqual({ magicLink: false })
})
