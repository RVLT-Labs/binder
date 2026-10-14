import { api } from '../api/client'

export interface AuthCapabilities {
  /** The server can deliver magic sign-in links (production needs SMTP for that). */
  magicLink: boolean
}

export const authCapabilitiesQueryKey = ['auth-capabilities'] as const

/** What the sign-in page may offer, from GET /api/health. Anything unclear means no magic link. */
export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  try {
    const health = await api.get<{ magicLink?: unknown }>('/health')
    return { magicLink: health.magicLink === true }
  } catch {
    return { magicLink: false }
  }
}
