import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api/client'

export interface SessionUser {
  id: string
  email: string
  name: string
}

export const meQueryKey = ['me'] as const

/**
 * The signed-in user, or null when signed out. Fetched once and kept: going offline mid-session
 * must not sign the user out, so this never refetches on its own. Sign-in and sign-out invalidate it.
 */
export function useSessionUser() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return (await api.get<{ user: SessionUser }>('/me')).user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}
