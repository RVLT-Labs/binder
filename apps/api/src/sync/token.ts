import { base64url, SignJWT } from 'jose'

export const POWERSYNC_KID = 'binder-1'
export const POWERSYNC_AUDIENCE = 'powersync'
const DEFAULT_TTL_SECONDS = 3600

/**
 * Mints the short-lived JWT a client presents to PowerSync. The service verifies it against the
 * same shared secret (see deploy/powersync/powersync.yaml): kid must match, aud must be listed,
 * sub is the user id that the sync streams read via auth.user_id().
 */
export async function mintPowerSyncToken(
  userId: string,
  secretBase64Url: string,
  opts: { ttlSeconds?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + ttl
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', kid: POWERSYNC_KID })
    .setSubject(userId)
    .setAudience([POWERSYNC_AUDIENCE])
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(base64url.decode(secretBase64Url))
  return { token, expiresAt: new Date(exp * 1000) }
}
