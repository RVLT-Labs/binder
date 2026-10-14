import { parseArgs } from 'node:util'
import { user } from '@binder/db'
import { eq } from 'drizzle-orm'
import { createAuth } from './auth/auth'
import { createMailer } from './auth/mailer'
import { loadConfig } from './config'
import { connectAndMigrate } from './db'
import { createToken } from './services'

const USAGE = [
  'Usage: cli create-user --email <email> --name <name> [--password-stdin]',
  '       cli create-token --email <email> --name <name> --scope <"*"|show-id,show-id>',
  'The password (minimum 8 characters) is read from the BINDER_PASSWORD environment variable,',
  'or from stdin when --password-stdin is given. It is never taken from argv.',
].join('\n')

async function readStdin(): Promise<string> {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data.replace(/\r?\n$/, '')
}

async function createUser(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-stdin': { type: 'boolean' },
    },
  })
  const { email, name } = values
  const password = values['password-stdin'] ? await readStdin() : process.env.BINDER_PASSWORD
  if (!email || !name || !password) throw new Error(USAGE)

  const config = loadConfig(process.env)
  const { db, pool } = await connectAndMigrate(config)
  try {
    const auth = createAuth({ db, config, sendMail: createMailer(config) })
    const { user } = await auth.api.signUpEmail({ body: { email, name, password } })
    console.log(user.id)
  } finally {
    await pool.end()
  }
}

async function createTokenCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { email: { type: 'string' }, name: { type: 'string' }, scope: { type: 'string' } },
  })
  const { email, name, scope } = values
  if (!email || !name || !scope) throw new Error(USAGE)
  const showScope = scope === '*' ? '*' : scope.split(',').map((s) => s.trim())

  const config = loadConfig(process.env)
  const { db, pool } = await connectAndMigrate(config)
  try {
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    if (!row) throw new Error(`No user with email ${email}`)
    const { token } = await createToken(
      db,
      { userId: row.id, via: 'web', agent: null },
      { name, showScope },
    )
    console.log(token)
  } finally {
    await pool.end()
  }
}

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'create-user') await createUser(rest)
  else if (command === 'create-token') await createTokenCommand(rest)
  else throw new Error(USAGE)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
