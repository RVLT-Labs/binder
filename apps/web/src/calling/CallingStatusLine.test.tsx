import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CallingStatusLine } from './CallingView'

vi.mock('@/components/SyncStatus', () => ({ SyncStatus: () => <output>Synced</output> }))
afterEach(() => vi.unstubAllGlobals())

test.each(['missing', 'partial', 'error'])(
  'B12 offline status makes no unverified cache promise when cache is %s',
  (cacheState) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const open = vi.fn(async () => {
      throw new Error(cacheState)
    })
    vi.stubGlobal('caches', { open })
    render(<CallingStatusLine show="Synthetic rehearsal" document="Local fixture" />)
    expect(screen.getByLabelText('Sync status').textContent?.trim()).toBe('Offline')
    expect(open).not.toHaveBeenCalled()
  },
)
