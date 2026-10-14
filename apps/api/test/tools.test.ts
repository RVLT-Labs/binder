import { afterEach, expect, test, vi } from 'vitest'
import { findMissingTools, skipWithoutTools } from './tools'

afterEach(() => vi.unstubAllEnvs())

test('nothing missing: the suite runs', () => {
  vi.stubEnv('CI', 'true')
  expect(skipWithoutTools('processing', [])).toBe(false)
})

test('missing tools outside CI: the suite is skipped with a warning', () => {
  vi.stubEnv('CI', '')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(skipWithoutTools('processing', ['ocrmypdf'])).toBe(true)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('ocrmypdf'))
})

test('missing tools in CI fail the run instead of passing vacuously', () => {
  vi.stubEnv('CI', 'true')
  expect(() => skipWithoutTools('processing', ['ocrmypdf', 'qpdf'])).toThrow(
    /processing.*CI.*ocrmypdf, qpdf/,
  )
})

test('findMissingTools reports a command that does not exist', () => {
  expect(findMissingTools([['binder-no-such-tool', ['-v']]])).toEqual(['binder-no-such-tool'])
})
