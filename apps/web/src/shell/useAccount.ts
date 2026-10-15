import { usePowerSync } from '@powersync/react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { authClient } from '@/auth/client'
import { useSessionUser } from '@/auth/session'
import { signOutAndClear } from '@/auth/signOut'
import { clearNotices } from '@/components/noticeStore'
import { clearOutbox } from '@/exports/outbox'
import { clearLocalData } from '@/powersync/provider'
import type { Account } from './types'

/**
 * The signed-in person and what signing out takes: the session, the local database, the export
 * outbox and the caches, and the question when uploads are still waiting (`signOutAndClear`).
 * Call it inside the PowerSync provider.
 */
export function useAccount(): Account {
  const { data: user } = useSessionUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const db = usePowerSync()
  const userId = user?.id
  return {
    email: user?.email ?? '',
    name: user?.name ?? '',
    signOut: (confirm) =>
      signOutAndClear({
        signOut: () => authClient.signOut(),
        clearOutbox: async () => {
          if (userId) await clearOutbox(userId)
        },
        clearLocalData,
        clearCache: () => {
          clearNotices()
          queryClient.clear()
        },
        toLogin: () => navigate({ to: '/login' }),
        pendingUploads: async () =>
          (await db.get<{ n: number }>('SELECT count(*) AS n FROM ps_crud')).n,
        confirm,
      }),
  }
}
