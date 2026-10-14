import { defineConfig, devices } from '@playwright/test'
import { API_URL, APP_URL, apiEnv, REPO_ROOT } from './env'

const reuse = !process.env.CI

/** The suite against the dev servers. The offline spec is excluded: see playwright.offline.config.ts. */
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
    // The dev server registers no service worker; the offline spec runs against a production build
    // in its own config (playwright.offline.config.ts), and nothing else should meet one.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      testIgnore: /offline\.spec\.ts/,
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
