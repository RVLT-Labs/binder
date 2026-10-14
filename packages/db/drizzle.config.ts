import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  // pg-boss owns its own schema and tables; keep them out of drizzle-kit.
  schemaFilter: ['public'],
  tablesFilter: ['!pgboss*'],
})
