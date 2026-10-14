import { parseArgs } from 'node:util'
import { createAuth } from './auth/auth'
import { createMailer } from './auth/mailer'
import { loadConfig } from './config'
import { connectAndMigrate } from './db'

const USAGE = [
  'Usage: cli create-user --email <email> --name <name> [--password-stdin]',
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

const [command, ...rest] = process.argv.slice(2)
try {
  if (command === 'create-user') await createUser(rest)
  else throw new Error(USAGE)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
