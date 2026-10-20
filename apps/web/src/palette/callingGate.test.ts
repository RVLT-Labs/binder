import { afterEach, expect, test, vi } from 'vitest'
import { isPaletteOpen, openPalette, registerDocumentHost, resetPaletteState } from './paletteState'

afterEach(resetPaletteState)

test('B08 Calling entry closes the palette and gates every opening entry point until leaving', () => {
  openPalette()
  expect(isPaletteOpen()).toBe(true)
  const host = {
    documentId: 'd',
    versionId: 'v',
    pageCount: 1,
    calling: true,
    goToPage: vi.fn(),
    searchFor: vi.fn(),
    openPrint: vi.fn(),
    toggleCalling: vi.fn(),
  }
  const unregister = registerDocumentHost(host)
  expect(isPaletteOpen()).toBe(false)
  openPalette()
  expect(isPaletteOpen()).toBe(false)
  unregister()
  registerDocumentHost({ ...host, calling: false })
  openPalette()
  expect(isPaletteOpen()).toBe(true)
})
