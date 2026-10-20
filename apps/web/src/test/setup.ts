import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { webLocks } from './webLocks'

beforeEach(() => {
  const locks = webLocks()
  vi.stubGlobal(
    'navigator',
    new Proxy(navigator, {
      get(target, key) {
        return key === 'locks' ? locks : Reflect.get(target, key, target)
      },
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
