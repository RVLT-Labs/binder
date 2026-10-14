import { parseArgs } from 'node:util'
import { createAuth } from './auth/auth'
import { createMailer } from './auth/mailer'
import { loadConfig } from './config'
import { connectAndMigrate } from './db'

const USAGE = 'Usage: cli create-user --email <email> --name <name> --password <password>'

async function createUser(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      password: { type: 'string' },
    },
  })
  const { email, name, password } = values
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
