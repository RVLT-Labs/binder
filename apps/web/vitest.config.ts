import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'

export default defineProject({
  plugins: [
    {
      name: 'native-test-sqlite',
      enforce: 'pre',
      // node:sqlite is a prefix-only built-in omitted by Node 22's builtinModules list.
      // The jsdom tests still execute in Node and must use its real SQLite, not a client bundle.
      resolveId(id) {
        if (id === 'node:sqlite') return { id, external: true }
      },
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ holds Playwright specs, run by `pnpm --filter @binder/web e2e`.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
