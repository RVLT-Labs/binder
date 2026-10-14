import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // 'fixtures' must exist: Vitest errors on a missing literal path (a glob would not).
    projects: ['packages/*', 'apps/*', 'fixtures'],
  },
})
