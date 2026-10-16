import { expect, test } from 'vitest'
import { describeFailure, FAILURE_CODES, formatBytes } from './processing'

test('describeFailure low_resolution interpolates the dpi (72)', () => {
  const f = describeFailure('low_resolution', { dpi: 72 })
  expect(f.title).toBe('couldn’t read text')
  expect(f.message).toBe(
    'Scanned at 72 dpi, so there is no text to search or anchor to. Try a 300 dpi scan. Or remove this upload, then upload the file again as a new document with Text recognition set to Never, and mark it up by position.',
  )
})

test('low_resolution without a dpi still reads as a sentence', () => {
  const f = describeFailure('low_resolution')
  expect(f.message).not.toMatch(/undefined|null|\{dpi\}/)
  expect(f.message).toMatch(/300 dpi scan/)
})

test('every FailureCode has a pill and message', () => {
  expect([...FAILURE_CODES].sort()).toEqual(
    [
      'cancelled',
      'enqueue_failed',
      'low_resolution',
      'no_text',
      'password_protected',
      'timeout',
      'unknown',
      'unreadable',
    ].sort(),
  )
  for (const code of FAILURE_CODES) {
    const f = describeFailure(code, { dpi: 72 })
    expect(f.title.length).toBeGreaterThan(0)
    expect(f.message.length).toBeGreaterThan(0)
    expect(f.title).toBe(f.title.toLowerCase())
  }
})

test('pills and copy follow the spec table', () => {
  const titles = Object.fromEntries(FAILURE_CODES.map((c) => [c, describeFailure(c).title]))
  expect(titles).toEqual({
    unreadable: 'couldn’t read file',
    password_protected: 'password protected',
    no_text: 'couldn’t read text',
    low_resolution: 'couldn’t read text',
    timeout: 'couldn’t finish',
    cancelled: 'cancelled',
    enqueue_failed: 'didn’t start',
    unknown: 'couldn’t process',
  })
  expect(describeFailure('password_protected').message).toBe(
    'This PDF needs a password to open. Remove the password and upload it again.',
  )
  expect(describeFailure('cancelled').message).toBe(
    'Cancelled. The file is still here if you want to try again.',
  )
})

test('deterministic codes are not retryable in place', () => {
  for (const code of ['unreadable', 'password_protected', 'no_text', 'low_resolution'] as const) {
    expect(describeFailure(code, { dpi: 72 }).retryable).toBe(false)
  }
  for (const code of ['timeout', 'cancelled', 'enqueue_failed', 'unknown'] as const) {
    expect(describeFailure(code).retryable).toBe(true)
  }
})

test('describeFailure falls back to unknown for a code it does not know', () => {
  expect(describeFailure('from_the_future').title).toBe('couldn’t process')
})

test('formatBytes gives 12 MB, 1.4 MB, 340 KB', () => {
  expect(formatBytes(12_000_000)).toBe('12 MB')
  expect(formatBytes(1_400_000)).toBe('1.4 MB')
  expect(formatBytes(340_000)).toBe('340 KB')
})

test('formatBytes edges: bytes, rounding up a unit, whole numbers, bad input', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(2_000_000)).toBe('2 MB')
  expect(formatBytes(999_999)).toBe('1 MB')
  expect(formatBytes(200_000_000)).toBe('200 MB')
  expect(formatBytes(1_500_000_000)).toBe('1.5 GB')
  expect(formatBytes(-5)).toBe('0 B')
  expect(formatBytes(Number.NaN)).toBe('0 B')
})

test('no_text and low_resolution name the way through: remove and upload again with text recognition off', () => {
  for (const code of ['no_text', 'low_resolution'] as const) {
    const { message, retryable } = describeFailure(code, { dpi: 72 })
    expect(retryable).toBe(false)
    expect(message).toMatch(/remove this upload/i)
    expect(message).toMatch(/new document/)
    expect(message).toMatch(/Text recognition set to Never/)
    expect(message).toMatch(/by position/)
  }
})
