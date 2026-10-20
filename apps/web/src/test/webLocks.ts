/** Deterministic FIFO Web Locks emulator: shared holders, exclusive waiters and ifAvailable. */
export function webLocks(): LockManager {
  type Request = {
    mode: LockMode
    run(lock: Lock | null): void
  }
  const names = new Map<string, { holders: LockMode[]; queue: Request[] }>()
  return {
    request<T>(name: string, options: LockOptions, callback: LockGrantedCallback<T>): Promise<T> {
      const state = names.get(name) ?? { holders: [], queue: [] }
      names.set(name, state)
      const mode = options.mode ?? 'exclusive'
      const available = () =>
        state.holders.length === 0 ||
        (mode === 'shared' && state.holders.every((m) => m === 'shared'))
      const drain = () => {
        while (state.queue.length > 0) {
          const next = state.queue[0]
          if (
            state.holders.length > 0 &&
            (next.mode === 'exclusive' || state.holders.includes('exclusive'))
          )
            return
          state.queue.shift()
          next.run({ name, mode: next.mode } as Lock)
        }
      }
      return new Promise<T>((resolve, reject) => {
        const request: Request = {
          mode,
          run(lock) {
            if (lock) state.holders.push(mode)
            Promise.resolve()
              .then(() => callback(lock))
              .then(resolve, reject)
              .finally(() => {
                if (lock) state.holders.splice(state.holders.indexOf(mode), 1)
                drain()
              })
          },
        }
        if (options.ifAvailable && (!available() || state.queue.length > 0)) request.run(null)
        else {
          state.queue.push(request)
          drain()
        }
      })
    },
  } as LockManager
}
