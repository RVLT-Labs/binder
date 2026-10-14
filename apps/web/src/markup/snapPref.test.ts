import { afterEach, expect, test, vi } from 'vitest'
import { effectiveSnap, loadSnapOverride, saveSnapOverride } from './snapPref'

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

test('without an override the document default decides', () => {
  expect(loadSnapOverride('doc1')).toBeNull()
  expect(effectiveSnap(1, null)).toBe(true)
  expect(effectiveSnap(0, null)).toBe(false)
  expect(effectiveSnap(null, null)).toBe(false)
})

test('the session override wins over the document default, per document', () => {
  saveSnapOverride('doc1', false)
  expect(sessionStorage.getItem('binder.snap.doc1')).not.toBeNull()
  expect(loadSnapOverride('doc1')).toBe(false)
  expect(effectiveSnap(1, loadSnapOverride('doc1'))).toBe(false)
  expect(loadSnapOverride('doc2')).toBeNull()
  saveSnapOverride('doc2', true)
  expect(effectiveSnap(0, loadSnapOverride('doc2'))).toBe(true)
})

test('blocked or garbled storage means no override, and saving never throws', () => {
  sessionStorage.setItem('binder.snap.doc1', 'maybe')
  expect(loadSnapOverride('doc1')).toBeNull()
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  })
  expect(loadSnapOverride('doc1')).toBeNull()
  expect(() => saveSnapOverride('doc1', true)).not.toThrow()
})
