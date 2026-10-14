import { defineConfig, devices } from '@playwright/test'
import { PREVIEW_URL, REPO_ROOT } from './env'
import base from './playwright.config'

/**
 * The offline spec needs the service worker, which only a production build has: it runs against
 * `vite build && vite preview` (port 4173; /api, /blobs and /mcp proxied to the API) with service
 * workers allowed. The dev servers still start, because signing in goes through the dev origin: the
 * API's auth only trusts APP_ORIGIN. The session cookie then works on the preview origin, since
 * cookies ignore ports.
 */
export default defineConfig({
  ...base,
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'offline',
      testMatch: /offline\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], baseURL: PREVIEW_URL, serviceWorkers: 'allow' },
    },
  ],
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : []),
    {
      name: 'preview',
      command:
        'pnpm --filter @binder/web exec vite build && pnpm --filter @binder/web exec vite preview',
      cwd: REPO_ROOT,
      url: PREVIEW_URL,
      // Always build fresh: a stale preview would test an old service worker.
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
