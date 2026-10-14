import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  noExternal: [/^@binder\//],
  clean: true,
})
