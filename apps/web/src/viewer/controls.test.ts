import { expect, test } from 'vitest'
import { fitWidthZoom, MAX_ZOOM, MIN_ZOOM, viewerKeyAction, zoomIn, zoomOut } from './controls'

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) =>
  viewerKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })

test('zoom steps stay between 50 and 400 percent', () => {
  expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.5, 4])
  expect(zoomIn(1)).toBeGreaterThan(1)
  expect(zoomOut(1)).toBeLessThan(1)
  expect(zoomIn(4)).toBe(4)
  expect(zoomOut(0.5)).toBe(0.5)
  // From an arbitrary fit-width zoom, the next step is the next preset, not a fixed increment.
  expect(zoomIn(1.03)).toBe(1.1)
  expect(zoomOut(1.03)).toBe(1)
})

test('fit width fills the available width and is clamped to the zoom range', () => {
  expect(fitWidthZoom(800, 400)).toBe(2)
  expect(fitWidthZoom(100, 600)).toBe(0.5)
  expect(fitWidthZoom(10_000, 600)).toBe(4)
})

test('viewer keys map to page and zoom actions', () => {
  expect(['PageDown', 'ArrowDown', 'ArrowRight'].map((k) => key(k))).toEqual([
    'nextPage',
    'nextPage',
    'nextPage',
  ])
  expect(['PageUp', 'ArrowUp', 'ArrowLeft'].map((k) => key(k))).toEqual([
    'prevPage',
    'prevPage',
    'prevPage',
  ])
  expect(['+', '=', '-', '0'].map((k) => key(k))).toEqual([
    'zoomIn',
    'zoomIn',
    'zoomOut',
    'fitWidth',
  ])
  expect(key('a')).toBeNull()
})

test('modified keys are left to the browser', () => {
  expect(key('+', { ctrlKey: true })).toBeNull()
  expect(key('0', { metaKey: true })).toBeNull()
  expect(key('ArrowDown', { altKey: true })).toBeNull()
})
