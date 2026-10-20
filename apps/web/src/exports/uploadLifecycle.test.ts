import 'fake-indexeddb/auto'
import { beforeEach, expect, test, vi } from 'vitest'
import { webLocks } from '../test/webLocks'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const entry = {
  id: 'retained-export-id',
  userId: 'A',
  showId: 'shared-show',
  meta: {
    id: 'retained-export-id',
    kind: 'pdf-script',
    filename: 'A.pdf',
    layerSelection: [],
    createdAt: '2026-10-20T00:00:00Z',
  },
  bytes: new TextEncoder().encode('%PDF-disposable'),
  contentType: 'application/pdf',
}
async function tab() {
  const local = await import('../auth/localWork')
  local.activateLocalUser('A')
  return { local, outbox: await import('./outbox') }
}
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('binder.localDbOwner', 'A')
  localStorage.setItem('binder.localDbClaim', 'claim-A')
  localStorage.setItem('binder.localDbDevice', 'retry-identity-A')
  vi.stubGlobal('navigator', { locks: webLocks() })
})

test.each([false, true])(
  'P1 stale cross-tab A snapshot never posts with B cookie (event: %s)',
  async (notify) => {
    const { outbox } = await tab()
    const list = deferred<(typeof entry)[]>()
    const started = deferred<void>()
    const remove = vi.fn(async () => {})
    let cookie = 'A'
    const post = vi.fn(async () => new Response(cookie, { status: 201 }))
    const flushing = outbox.flushOutbox('A', {
      store: {
        list: () => {
          started.resolve()
          return list.promise
        },
        remove,
        put: async () => {},
        clear: async () => {},
      },
      post,
    })
    await started.promise
    localStorage.setItem('binder.localDbOwner', 'B')
    localStorage.setItem('binder.localDbClaim', 'claim-B')
    cookie = 'B'
    if (notify) window.dispatchEvent(new StorageEvent('storage'))
    list.resolve([entry])
    await flushing.catch(() => {})
    expect(post).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  },
)

test('P1 shared lifecycle lock excludes other-tab sign-out through upload completion', async () => {
  const { outbox } = await tab()
  const response = deferred<Response>()
  const posted = deferred<void>()
  const store = {
    list: async () => [entry],
    remove: vi.fn(async () => {}),
    put: async () => {},
    clear: async () => {},
  }
  const flushing = outbox.flushOutbox('A', {
    store,
    post: () => {
      posted.resolve()
      return response.promise
    },
  })
  await posted.promise
  vi.resetModules()
  const other = await import('../auth/localWork')
  other.activateLocalUser('A')
  let acquired = false
  const signingOut = other.quiesceLocalWork().then((release) => {
    acquired = true
    return release
  })
  // Drain microtasks so an unprotected exclusive request has time to acquire.
  for (let i = 0; i < 20; i++) await Promise.resolve()
  const beforeResponse = acquired
  response.resolve(new Response('', { status: 201 }))
  await flushing
  await (await signingOut)()
  expect(beforeResponse).toBe(false)
  expect(store.remove).toHaveBeenCalledWith(entry.id)
})

test('P1 revoked cross-tab request aborts and a late final refusal retains the queued identity', async () => {
  const { outbox } = await tab()
  const response = deferred<Response>()
  const posted = deferred<void>()
  let signal: AbortSignal | undefined
  const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
    signal = init?.signal ?? undefined
    posted.resolve()
    return response.promise
  })
  vi.stubGlobal('fetch', fetcher)
  const store = {
    list: async () => [entry],
    remove: vi.fn(async () => {}),
    put: async () => {},
    clear: async () => {},
  }
  const flushing = outbox.flushOutbox('A', { store })
  await posted.promise
  localStorage.setItem('binder.localDbClaim', 'revoked-A')
  window.dispatchEvent(new StorageEvent('storage'))
  response.resolve(new Response('', { status: 403 }))
  await flushing.catch(() => {})
  expect(signal?.aborted).toBe(true)
  expect(store.remove).not.toHaveBeenCalled()
  expect(localStorage.getItem('binder.localDbDevice')).toBe('retry-identity-A')
})

test('P1 expected-account mismatch retains exact queued bytes/id and retries for A', async () => {
  const { outbox } = await tab()
  const items = new Map([[entry.id, entry]])
  const store = {
    list: async () => [...items.values()],
    remove: async (id: string) => {
      items.delete(id)
    },
    put: async () => {},
    clear: async () => {},
  }
  const post = vi.fn(async () => new Response('', { status: 412 }))
  expect(await outbox.flushOutbox('A', { store, post })).toEqual({ sent: 0, kept: 1, dropped: 0 })
  expect(items.get(entry.id)).toBe(entry)
  post.mockImplementation(async () => new Response('', { status: 201 }))
  expect(await outbox.flushOutbox('A', { store, post })).toEqual({ sent: 1, kept: 0, dropped: 0 })
  expect(post.mock.calls).toHaveLength(2)
})

test('P1 upload sends expected account alongside normal credentials and stable metadata', async () => {
  const { outbox } = await tab()
  const fetcher = vi.fn(async () => new Response('', { status: 201 }))
  vi.stubGlobal('fetch', fetcher)
  await outbox.postExport(entry)
  const init = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1]
  expect(new Headers(init.headers).get('X-Binder-Expected-User')).toBe('A')
  expect(init.credentials).toBe('include')
  expect(JSON.parse((init.body as FormData).get('meta') as string).id).toBe(entry.id)
})
