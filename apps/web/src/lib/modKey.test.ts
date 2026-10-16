import { afterEach, expect, it, vi } from 'vitest'
import { isApplePlatform, modLabel } from './modKey'

afterEach(() => vi.restoreAllMocks())

it('says ⌘ on an Apple platform and Ctrl elsewhere', () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  expect(isApplePlatform()).toBe(true)
  expect(modLabel('K')).toBe('⌘K')
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
  expect(isApplePlatform()).toBe(false)
  expect(modLabel('K')).toBe('Ctrl K')
})
