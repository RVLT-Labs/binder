import * as z from 'zod'

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BLOB_ROOT: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url(),
  AUTH_SECRET: z.string().min(32),
  POWERSYNC_JWT_SECRET: z.string().regex(/^[A-Za-z0-9_-]+$/, 'must be base64url'),
  POWERSYNC_URL: z.url(),
  SMTP_URL: z.string().min(1).optional(),
  ALLOW_SIGNUP: bool.default(false),
  NODE_ENV: z.string().optional(),
})

export type Config = z.infer<typeof schema>

/**
 * The secrets committed in the repo for local development (.env.example, deploy/docker-compose.dev.yml).
 * They are public, so a production process refuses to run with any of them.
 */
export const DEV_SECRETS: Readonly<
  Partial<Record<'AUTH_SECRET' | 'POWERSYNC_JWT_SECRET', string[]>>
> = {
  AUTH_SECRET: ['dev-only-auth-secret-change-me-0123456789'],
  POWERSYNC_JWT_SECRET: ['YmluZGVyLWRldi1wb3dlcnN5bmMtc2VjcmV0LTMyYnk'],
}

/**
 * Magic-link sign-in needs a way to deliver the link. Production without SMTP has none: logging the
 * link would turn the container log into a store of live credentials, so the feature is off.
 */
export function magicLinkEnabled(config: Pick<Config, 'NODE_ENV' | 'SMTP_URL'>): boolean {
  return config.SMTP_URL !== undefined || config.NODE_ENV !== 'production'
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  // Treat empty strings as unset so a blank line in .env behaves like a missing key.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  )
  const result = schema.safeParse(cleaned)
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid configuration: ${problems}`)
  }
  if (cleaned.NODE_ENV === 'production') {
    for (const [key, devValues] of Object.entries(DEV_SECRETS)) {
      if (devValues?.includes(result.data[key as keyof typeof DEV_SECRETS] as string)) {
        throw new Error(
          `Invalid configuration: ${key} is a development value committed in the repository; generate a fresh secret for production`,
        )
      }
    }
  }
  return result.data
}
