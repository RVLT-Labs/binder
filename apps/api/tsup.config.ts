import { cp } from 'node:fs/promises'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  noExternal: [/^@binder\//],
  clean: true,
  async onSuccess() {
    // The bundled runMigrations cannot find the db package's folder, so ship it next to the bundle.
    await cp('../../packages/db/drizzle', 'dist/drizzle', { recursive: true })
  },
})
