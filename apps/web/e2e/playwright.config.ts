import { defineConfig, devices } from '@playwright/test'
import { API_URL, APP_URL, apiEnv, REPO_ROOT } from './env'

const reuse = !process.env.CI

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: APP_URL,
    // The PWA service worker arrives in Task 16; keep it out of these specs until then.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'pnpm --filter @binder/api exec tsx src/server.ts',
      cwd: REPO_ROOT,
      env: apiEnv(),
      url: `${API_URL}/api/health`,
      reuseExistingServer: reuse,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'web',
      command: 'pnpm --filter @binder/web dev',
      cwd: REPO_ROOT,
      url: APP_URL,
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
  ],
})
