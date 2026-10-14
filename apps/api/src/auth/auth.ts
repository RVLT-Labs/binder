import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { Db } from '@binder/db'
import * as schema from '@binder/db'
import { newId } from '@binder/shared'
import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import type { Config } from '../config'
import { createOrganisation } from '../services/tenancy'
import type { SendMail } from './mailer'

export interface AuthOptions {
  db: Db
  config: Pick<Config, 'AUTH_SECRET' | 'APP_ORIGIN' | 'ALLOW_SIGNUP'>
  sendMail: SendMail
  /** Better Auth turns its rate limiter on in production only; tests pass `{ enabled: true }`. */
  rateLimit?: { enabled: boolean }
}

/**
 * Where the client address comes from, for the rate limiter. Production traffic is Cloudflare tunnel
 * (sets CF-Connecting-IP), Traefik, Caddy, then this server, so the connecting peer is always a proxy.
 * CF-Connecting-IP wins; X-Forwarded-For is the fallback, read from the right and skipping private
 * proxy addresses. Safe because the API is reachable only through those proxies.
 */
export const IP_ADDRESS_OPTIONS = {
  ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
  trustedProxies: [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '127.0.0.0/8',
    '100.64.0.0/10',
    'fc00::/7',
    '::1/128',
  ],
}

export function createAuth({ db, config, sendMail, rateLimit }: AuthOptions) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.AUTH_SECRET,
    // The SPA proxies /api to this server, so the app origin is also the auth origin.
    baseURL: config.APP_ORIGIN,
    basePath: '/api/auth',
    trustedOrigins: [config.APP_ORIGIN],
    emailAndPassword: { enabled: true },
    ...(rateLimit ? { rateLimit } : {}),
    plugins: [
      magicLink({
        // Verifying a link for an unknown email would otherwise create a user, bypassing the sign-up guard.
        disableSignUp: !config.ALLOW_SIGNUP,
        sendMagicLink: async ({ email, url }) => {
          await sendMail({
            to: email,
            subject: 'Your Binder sign-in link',
            text: `Sign in to Binder: ${url}\n\nIf you did not request this, ignore this email.`,
          })
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Every user starts with a personal organisation they own.
          after: async (created) => {
            await createOrganisation(
              db,
              { userId: created.id, via: 'web', agent: null },
              { name: `${created.name}'s organisation` },
            )
          },
        },
      },
    },
    advanced: { database: { generateId: () => newId() }, ipAddress: IP_ADDRESS_OPTIONS },
  })
}

export type Auth = ReturnType<typeof createAuth>
