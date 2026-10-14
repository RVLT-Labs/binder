import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api/client'

export interface SessionUser {
  id: string
  email: string
  name: string
}

export const meQueryKey = ['me'] as const

const REMEMBERED_KEY = 'binder.sessionUser'

function remembered(): SessionUser | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY)
    const user = raw ? JSON.parse(raw) : null
    return user && typeof user.id === 'string' ? user : null
  } catch {
    return null
  }
}

function remember(user: SessionUser | null): void {
  try {
    if (user) localStorage.setItem(REMEMBERED_KEY, JSON.stringify(user))
    else localStorage.removeItem(REMEMBERED_KEY)
  } catch {
    // Storage blocked: an offline start then needs the server, as it would have before.
  }
}

/** Forgets the remembered user, so the next start without a server shows the login screen. */
export function forgetSessionUser(): void {
  remember(null)
}

/**
 * Asks the server who is signed in. The server saying 401 means nobody. Any other failure (no
 * network, a failing server) falls back to the user remembered from the last successful answer, so
 * the app opens offline on the documents already on the device; with nobody remembered it throws.
 */
export async function fetchSessionUser(): Promise<SessionUser | null> {
  try {
    const { user } = await api.get<{ user: SessionUser }>('/me')
    remember(user)
    return user
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      remember(null)
      return null
    }
    const saved = remembered()
    if (saved) return saved
    throw err
  }
}

/**
 * The signed-in user, or null when signed out. Fetched once and kept: going offline mid-session
 * must not sign the user out, so this never refetches on its own. Sign-in and sign-out invalidate it.
 */
export function useSessionUser() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: fetchSessionUser,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
