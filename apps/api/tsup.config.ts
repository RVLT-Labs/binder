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
    // The MCP guides resource reads these next to the bundle (src/mcp/resources/guides.ts).
    await cp('../../docs/guides', 'dist/guides', { recursive: true })
    // The MCP skill resource serves the agent skill from next to the bundle (src/mcp/resources/skill.ts).
    await cp('../../skills/binder', 'dist/skill', { recursive: true })
  },
})
