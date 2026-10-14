import { expect, test, vi } from 'vitest'
import { createRenderQueue } from './renderQueue'

/** A stand-in for a PDF.js RenderTask: a promise you settle by hand, and a cancel that rejects it. */
function fakeTask() {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  const cancel = vi.fn(() => reject(new Error('Rendering cancelled')))
  return { task: { promise, cancel }, resolve, fail: () => reject(new Error('boom')) }
}

const noop = () => {}
const settle = () => new Promise((r) => setTimeout(r, 0))

test('render queue runs at most 2 at once and cancel removes a pending task', async () => {
  const queue = createRenderQueue()
  const tasks = [fakeTask(), fakeTask(), fakeTask(), fakeTask()]
  const runs = tasks.map((t) => vi.fn(() => t.task))

  queue.enqueue('a', runs[0], noop)
  queue.enqueue('b', runs[1], noop)
  const cancelC = queue.enqueue('c', runs[2], noop)
  queue.enqueue('d', runs[3], noop)
  expect(runs.map((r) => r.mock.calls.length)).toEqual([1, 1, 0, 0])

  cancelC()
  tasks[0].resolve()
  await settle()
  // c was cancelled while pending, so d takes the free slot and c never runs.
  expect(runs.map((r) => r.mock.calls.length)).toEqual([1, 1, 0, 1])
  expect(tasks[2].task.cancel).not.toHaveBeenCalled()
})

test('a failed task frees its slot', async () => {
  const queue = createRenderQueue(1)
  const [a, b] = [fakeTask(), fakeTask()]
  const runB = vi.fn(() => b.task)
  queue.enqueue('a', () => a.task, noop)
  queue.enqueue('b', runB, noop)
  a.fail()
  await settle()
  expect(runB).toHaveBeenCalledOnce()
})

test('cancelling a running task cancels it and frees the slot once it settles', async () => {
  const queue = createRenderQueue(1)
  const [a, b] = [fakeTask(), fakeTask()]
  const runB = vi.fn(() => b.task)
  const cancelA = queue.enqueue('a', () => a.task, noop)
  queue.enqueue('b', runB, noop)

  cancelA()
  expect(a.task.cancel).toHaveBeenCalledOnce()
  await settle()
  expect(runB).toHaveBeenCalledOnce()
})

test('enqueueing a key again replaces its earlier render', async () => {
  const queue = createRenderQueue(1)
  const [running, stale, fresh] = [fakeTask(), fakeTask(), fakeTask()]
  const runStale = vi.fn(() => stale.task)
  const runFresh = vi.fn(() => fresh.task)

  queue.enqueue('page-1', () => running.task, noop)
  queue.enqueue('page-2', runStale, noop)
  queue.enqueue('page-2', runFresh, noop)
  // The running render of a key is cancelled too, as a zoom change does.
  queue.enqueue(
    'page-1',
    vi.fn(() => fakeTask().task),
    noop,
  )
  expect(running.task.cancel).toHaveBeenCalledOnce()

  await settle()
  expect(runStale).not.toHaveBeenCalled()
  expect(runFresh).toHaveBeenCalledOnce()
})

test('a cancel function is harmless after its task finished', async () => {
  const queue = createRenderQueue(1)
  const a = fakeTask()
  const cancelA = queue.enqueue('a', () => a.task, noop)
  a.resolve()
  await settle()
  cancelA()
  expect(a.task.cancel).not.toHaveBeenCalled()
})

test('a run that throws frees its slot', async () => {
  const queue = createRenderQueue(1)
  const b = fakeTask()
  const runB = vi.fn(() => b.task)
  queue.enqueue(
    'a',
    () => {
      throw new Error('page gone')
    },
    () => {},
  )
  queue.enqueue('b', runB, noop)
  expect(runB).toHaveBeenCalledOnce()
})

test('a run that throws is reported to the caller instead of swallowed', () => {
  const queue = createRenderQueue(1)
  const onError = vi.fn()
  const boom = new Error('canvas too large')
  queue.enqueue(
    'a',
    () => {
      throw boom
    },
    onError,
  )
  expect(onError).toHaveBeenCalledExactlyOnceWith(boom)
})

test('a run that throws while another waits for its slot is reported when it runs', async () => {
  const queue = createRenderQueue(1)
  const first = fakeTask()
  const onError = vi.fn()
  queue.enqueue('a', () => first.task, noop)
  queue.enqueue(
    'b',
    () => {
      throw new Error('late failure')
    },
    onError,
  )
  expect(onError).not.toHaveBeenCalled()
  first.resolve()
  await settle()
  expect(onError).toHaveBeenCalledOnce()
})

test('a cancelled render never reports', () => {
  const queue = createRenderQueue(1)
  const first = fakeTask()
  const onError = vi.fn()
  queue.enqueue('a', () => first.task, noop)
  const cancel = queue.enqueue(
    'b',
    () => {
      throw new Error('should not run')
    },
    onError,
  )
  cancel()
  first.resolve()
  expect(onError).not.toHaveBeenCalled()
})
