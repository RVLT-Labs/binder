// Only for `auth generate` (see packages/db/src/schema/auth.ts). Not imported by app code.
// The pool connects lazily, so generating the schema never touches a database.
import { createDb } from '@binder/db'
import { createAuth } from './auth'

const { db } = createDb('postgres://schema:schema@localhost:5432/schema')

export const auth = createAuth({
  db,
  config: {
    AUTH_SECRET: 'schema-generation-placeholder-secret-0000',
    APP_ORIGIN: 'http://localhost:5173',
  },
  sendMail: async () => {},
})
