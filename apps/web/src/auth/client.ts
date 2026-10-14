import { magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/** Better Auth lives at /api/auth on the same origin (Vite proxies /api to the API in dev). */
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [magicLinkClient()],
})
