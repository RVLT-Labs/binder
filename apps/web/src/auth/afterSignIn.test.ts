import { expect, test, vi } from 'vitest'

const flushSoon = vi.fn()
vi.mock('../exports/flusher', () => ({ flushSoon: () => flushSoon() }))
const { afterSignIn } = await import('./afterSignIn')

test('after sign-in the session is refreshed, waiting exports are flushed, then home opens', async () => {
  const order: string[] = []
  flushSoon.mockImplementation(() => order.push('flush'))
  await afterSignIn({
    refreshSession: async () => void order.push('session'),
    toHome: async () => void order.push('home'),
  })
  expect(order).toEqual(['session', 'flush', 'home'])
})
