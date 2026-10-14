import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { DEV_SECRETS, loadConfig } from '../src/config'

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

const devSecrets = {
  AUTH_SECRET: 'dev-only-auth-secret-change-me-0123456789',
  POWERSYNC_JWT_SECRET: 'YmluZGVyLWRldi1wb3dlcnN5bmMtc2VjcmV0LTMyYnk',
}

test('production refuses the dev secrets committed in the repo', () => {
  const prod = { ...base, NODE_ENV: 'production' }
  expect(() => loadConfig({ ...prod, AUTH_SECRET: devSecrets.AUTH_SECRET })).toThrow(
    /AUTH_SECRET.*development/,
  )
  expect(() =>
    loadConfig({ ...prod, POWERSYNC_JWT_SECRET: devSecrets.POWERSYNC_JWT_SECRET }),
  ).toThrow(/POWERSYNC_JWT_SECRET.*development/)
  // Fresh secrets, including Coolify's 64 hex characters, are fine.
  const hex = 'a1'.repeat(32)
  const c = loadConfig({ ...prod, AUTH_SECRET: 'x'.repeat(64), POWERSYNC_JWT_SECRET: hex })
  expect(c.POWERSYNC_JWT_SECRET).toBe(hex)
})

test('outside production the dev secrets are allowed', () => {
  expect(loadConfig({ ...base, ...devSecrets }).AUTH_SECRET).toBe(devSecrets.AUTH_SECRET)
})

test('the refused values are the ones committed in .env.example and docker-compose.dev.yml', () => {
  const root = join(import.meta.dirname, '..', '..', '..')
  const example = readFileSync(join(root, '.env.example'), 'utf8')
  const compose = readFileSync(join(root, 'deploy', 'docker-compose.dev.yml'), 'utf8')
  expect(example).toContain(`AUTH_SECRET=${devSecrets.AUTH_SECRET}`)
  expect(example).toContain(`POWERSYNC_JWT_SECRET=${devSecrets.POWERSYNC_JWT_SECRET}`)
  expect(compose).toContain(devSecrets.POWERSYNC_JWT_SECRET)
  expect(DEV_SECRETS.AUTH_SECRET).toEqual([devSecrets.AUTH_SECRET])
  expect(DEV_SECRETS.POWERSYNC_JWT_SECRET).toEqual([devSecrets.POWERSYNC_JWT_SECRET])
})
