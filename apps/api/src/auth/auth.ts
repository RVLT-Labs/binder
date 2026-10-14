import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { Db } from '@binder/db'
import * as schema from '@binder/db'
import { newId } from '@binder/shared'
import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import type { Config } from '../config'
import type { SendMail } from './mailer'

export interface AuthOptions {
  db: Db
  config: Pick<Config, 'AUTH_SECRET' | 'APP_ORIGIN'>
  sendMail: SendMail
}

export function createAuth({ db, config, sendMail }: AuthOptions) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.AUTH_SECRET,
    // The SPA proxies /api to this server, so the app origin is also the auth origin.
    baseURL: config.APP_ORIGIN,
    basePath: '/api/auth',
    trustedOrigins: [config.APP_ORIGIN],
    emailAndPassword: { enabled: true },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMail({
            to: email,
            subject: 'Your Binder sign-in link',
            text: `Sign in to Binder: ${url}\n\nIf you did not request this, ignore this email.`,
          })
        },
      }),
    ],
    advanced: { database: { generateId: () => newId() } },
  })
}

export type Auth = ReturnType<typeof createAuth>
