import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ holds Playwright specs, run by `pnpm --filter @binder/web e2e`.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
