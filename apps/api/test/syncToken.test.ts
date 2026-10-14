import { base64url, jwtVerify } from 'jose'
import { describe, expect, test } from 'vitest'
import { createToken } from '../src/services'
import { mintPowerSyncToken } from '../src/sync/token'
import { createTestApp, createTestUser, testConfig } from './helpers'

const secret = testConfig().POWERSYNC_JWT_SECRET

describe('mintPowerSyncToken', () => {
  test('verifies with the shared secret and carries the right claims', async () => {
    const { token, expiresAt } = await mintPowerSyncToken('user-1', secret)
    const { payload, protectedHeader } = await jwtVerify(token, base64url.decode(secret), {
      audience: 'powersync',
    })
    expect(payload.sub).toBe('user-1')
    expect(protectedHeader.kid).toBe('binder-1')
    expect(protectedHeader.alg).toBe('HS256')
    expect(payload.iat).toBeTypeOf('number')
    // biome-ignore lint/style/noNonNullAssertion: asserted above and by jwtVerify
    expect(payload.exp! - payload.iat!).toBe(3600)
    expect(expiresAt.getTime()).toBe((payload.exp as number) * 1000)
  })

  test('ttlSeconds overrides the lifetime', async () => {
    const { token } = await mintPowerSyncToken('user-1', secret, { ttlSeconds: 60 })
    const { payload } = await jwtVerify(token, base64url.decode(secret), { audience: 'powersync' })
    // biome-ignore lint/style/noNonNullAssertion: set by the minter
    expect(payload.exp! - payload.iat!).toBe(60)
  })

  test('does not verify under a different secret', async () => {
    const { token } = await mintPowerSyncToken('user-1', secret)
    await expect(
      jwtVerify(token, base64url.decode('b3RoZXItc2VjcmV0'), { audience: 'powersync' }),
    ).rejects.toThrow()
  })
})

describe('GET /api/sync/token', () => {
  test('requires a session', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/sync/token')
    expect(res.status).toBe(401)
  })

  test('returns a token for the signed-in user and the endpoint', async () => {
    const { app, deps } = await createTestApp()
    const user = await createTestUser(app, deps, {
      email: 'sync1@x.test',
      name: 'Syd',
      password: 'password123',
    })
    const res = await app.request('/api/sync/token', { headers: { cookie: user.cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; expiresAt: string; endpoint: string }
    expect(body.endpoint).toBe(deps.config.POWERSYNC_URL)
    const { payload } = await jwtVerify(body.token, base64url.decode(secret), {
      audience: 'powersync',
    })
    expect(payload.sub).toBe(user.id)
    expect(new Date(body.expiresAt).getTime()).toBe((payload.exp as number) * 1000)
  })

  test('a bearer personal access token cannot mint a sync token', async () => {
    const { app, deps } = await createTestApp()
    const user = await createTestUser(app, deps, {
      email: 'sync2@x.test',
      name: 'Sam',
      password: 'password123',
    })
    const { token } = await createToken(
      deps.db,
      { userId: user.id, via: 'web', agent: null },
      { name: 'pat', showScope: '*' },
    )
    const res = await app.request('/api/sync/token', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })
})
