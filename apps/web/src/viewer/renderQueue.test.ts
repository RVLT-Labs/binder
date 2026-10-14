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

const settle = () => new Promise((r) => setTimeout(r, 0))

test('render queue runs at most 2 at once and cancel removes a pending task', async () => {
  const queue = createRenderQueue()
  const tasks = [fakeTask(), fakeTask(), fakeTask(), fakeTask()]
  const runs = tasks.map((t) => vi.fn(() => t.task))

  queue.enqueue('a', runs[0])
  queue.enqueue('b', runs[1])
  const cancelC = queue.enqueue('c', runs[2])
  queue.enqueue('d', runs[3])
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
  queue.enqueue('a', () => a.task)
  queue.enqueue('b', runB)
  a.fail()
  await settle()
  expect(runB).toHaveBeenCalledOnce()
})

test('cancelling a running task cancels it and frees the slot once it settles', async () => {
  const queue = createRenderQueue(1)
  const [a, b] = [fakeTask(), fakeTask()]
  const runB = vi.fn(() => b.task)
  const cancelA = queue.enqueue('a', () => a.task)
  queue.enqueue('b', runB)

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

  queue.enqueue('page-1', () => running.task)
  queue.enqueue('page-2', runStale)
  queue.enqueue('page-2', runFresh)
  // The running render of a key is cancelled too, as a zoom change does.
  queue.enqueue(
    'page-1',
    vi.fn(() => fakeTask().task),
  )
  expect(running.task.cancel).toHaveBeenCalledOnce()

  await settle()
  expect(runStale).not.toHaveBeenCalled()
  expect(runFresh).toHaveBeenCalledOnce()
})

test('a cancel function is harmless after its task finished', async () => {
  const queue = createRenderQueue(1)
  const a = fakeTask()
  const cancelA = queue.enqueue('a', () => a.task)
  a.resolve()
  await settle()
  cancelA()
  expect(a.task.cancel).not.toHaveBeenCalled()
})

test('a run that throws frees its slot', async () => {
  const queue = createRenderQueue(1)
  const b = fakeTask()
  const runB = vi.fn(() => b.task)
  queue.enqueue('a', () => {
    throw new Error('page gone')
  })
  queue.enqueue('b', runB)
  expect(runB).toHaveBeenCalledOnce()
})
