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
})

export type Config = z.infer<typeof schema>

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
  return result.data
}
