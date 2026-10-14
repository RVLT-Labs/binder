/** The part of a PDF.js RenderTask the queue needs. */
export interface QueuedTask {
  promise: Promise<unknown>
  cancel(): void
}

export interface RenderQueue {
  /**
   * Runs `run` when a slot is free. A key names one canvas: enqueueing it again cancels its earlier
   * render, pending or running. Returns a function that cancels this render. If `run` throws,
   * `onError` is told (unless this render was cancelled first); the slot is freed either way.
   */
  enqueue(key: string, run: () => QueuedTask, onError: (error: unknown) => void): () => void
}

interface Entry {
  key: string
  run: () => QueuedTask
  onError: (error: unknown) => void
  task?: QueuedTask
  cancelled: boolean
}

/** Bounds concurrent page renders so a fast scroll does not start dozens of them at once. */
export function createRenderQueue(maxConcurrent = 2): RenderQueue {
  const pending: Entry[] = []
  const running = new Set<Entry>()
  const latest = new Map<string, Entry>()

  function release(entry: Entry) {
    running.delete(entry)
    if (latest.get(entry.key) === entry) latest.delete(entry.key)
  }

  function pump() {
    while (running.size < maxConcurrent && pending.length > 0) {
      const entry = pending.shift() as Entry
      running.add(entry)
      try {
        entry.task = entry.run()
      } catch (err) {
        release(entry)
        entry.onError(err)
        continue
      }
      const done = () => {
        release(entry)
        pump()
      }
      entry.task.promise.then(done, done)
    }
  }

  function cancel(entry: Entry) {
    if (entry.cancelled) return
    entry.cancelled = true
    if (latest.get(entry.key) === entry) latest.delete(entry.key)
    const at = pending.indexOf(entry)
    if (at >= 0) pending.splice(at, 1)
    // A running task keeps its slot until its promise settles, which cancel() brings about.
    else if (running.has(entry)) entry.task?.cancel()
  }

  return {
    enqueue(key, run, onError) {
      const previous = latest.get(key)
      if (previous) cancel(previous)
      const entry: Entry = { key, run, onError, cancelled: false }
      latest.set(key, entry)
      pending.push(entry)
      pump()
      return () => cancel(entry)
    },
  }
}
