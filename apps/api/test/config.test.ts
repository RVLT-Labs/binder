import { expect, test } from 'vitest'
import { loadConfig } from '../src/config'

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BLOB_ROOT: '/tmp/blobs',
  APP_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'a'.repeat(32),
  POWERSYNC_JWT_SECRET: 'c2VjcmV0LXZhbHVlLXNlY3JldA',
  POWERSYNC_URL: 'http://localhost:8080',
}

test('applies defaults', () => {
  const c = loadConfig(base)
  expect(c.PORT).toBe(3000)
  expect(c.ALLOW_SIGNUP).toBe(false)
  expect(c.SMTP_URL).toBeUndefined()
})

test('parses PORT and ALLOW_SIGNUP', () => {
  const c = loadConfig({ ...base, PORT: '4000', ALLOW_SIGNUP: 'true' })
  expect(c.PORT).toBe(4000)
  expect(c.ALLOW_SIGNUP).toBe(true)
})

test('names the missing key', () => {
  const { AUTH_SECRET: _omit, ...rest } = base
  expect(() => loadConfig(rest)).toThrow(/AUTH_SECRET/)
})

test('names an invalid key', () => {
  expect(() => loadConfig({ ...base, POWERSYNC_JWT_SECRET: 'not base64url!!' })).toThrow(
    /POWERSYNC_JWT_SECRET/,
  )
  expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/)
})
