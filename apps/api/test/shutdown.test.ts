import { expect, test, vi } from 'vitest'
import { createShutdown } from '../src/shutdown'

function steps(overrides: Partial<Parameters<typeof createShutdown>[0]> = {}) {
  return {
    closeServer: vi.fn(),
    stopQueue: vi.fn(async () => {}),
    endPool: vi.fn(async () => {}),
    exit: vi.fn(),
    log: vi.fn(),
    ...overrides,
  }
}

test('stops everything in order and exits 0', async () => {
  const s = steps()
  await createShutdown(s)('SIGTERM')
  expect(s.closeServer).toHaveBeenCalledOnce()
  expect(s.stopQueue).toHaveBeenCalledOnce()
  expect(s.endPool).toHaveBeenCalledOnce()
  expect(s.exit).toHaveBeenCalledExactlyOnceWith(0)
})

test('a failing queue stop is logged, the pool still closes, and the process still exits', async () => {
  const boom = new Error('boss stop timed out')
  const s = steps({ stopQueue: vi.fn(async () => Promise.reject(boom)) })
  await createShutdown(s)('SIGTERM')
  expect(s.log).toHaveBeenCalledWith('shutdown: stop job queue failed', boom)
  expect(s.endPool).toHaveBeenCalledOnce()
  expect(s.exit).toHaveBeenCalledExactlyOnceWith(1)
})

test('a failing pool close still exits', async () => {
  const s = steps({ endPool: vi.fn(async () => Promise.reject(new Error('pool'))) })
  await createShutdown(s)('SIGINT')
  expect(s.exit).toHaveBeenCalledExactlyOnceWith(1)
})

test('a synchronous throw from closing the server does not skip the rest', async () => {
  const s = steps({
    closeServer: vi.fn(() => {
      throw new Error('not running')
    }),
  })
  await createShutdown(s)('SIGTERM')
  expect(s.stopQueue).toHaveBeenCalledOnce()
  expect(s.exit).toHaveBeenCalledExactlyOnceWith(1)
})

test('a second signal while stopping is ignored', async () => {
  const s = steps()
  const shutdown = createShutdown(s)
  await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')])
  expect(s.stopQueue).toHaveBeenCalledOnce()
  expect(s.exit).toHaveBeenCalledOnce()
})
