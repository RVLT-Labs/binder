import { usePowerSync } from '@powersync/react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { authClient } from '@/auth/client'
import { countLocalUploadsForSignOut } from '@/auth/localWork'
import { useSessionUser } from '@/auth/session'
import { signOutAndClear } from '@/auth/signOut'
import { clearNotices } from '@/components/noticeStore'
import { clearOutbox, pendingExports, stopExportUploads } from '@/exports/outbox'
import { stopKeepOffline } from '@/offline/keepOffline/active'
import { clearOfflinePrefs } from '@/offline/keepOffline/store'
import { readOwner } from '@/powersync/ownership'
import { clearLocalData } from '@/powersync/provider'
import type { Account } from './types'

/**
 * The signed-in person and what signing out takes: the session, the local database, the export
 * outbox, keep-offline (stopped first, then its preferences) and the caches, and the question when uploads are still waiting (`signOutAndClear`).
 * Call it inside the PowerSync provider.
 */
export function useAccount(): Account {
  const { data: user } = useSessionUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const db = usePowerSync()
  const userId = user?.id
  const assertOwner = () => {
    if (!userId || readOwner() !== userId)
      throw new Error('The local database owner changed or could not be verified')
  }
  return {
    email: user?.email ?? '',
    name: user?.name ?? '',
    signOut: (confirm) =>
      signOutAndClear({
        signOut: () => authClient.signOut(),
        clearOutbox: async () => {
          if (userId) await clearOutbox(userId)
        },
        clearOfflinePrefs: async () => {
          if (userId) await clearOfflinePrefs(userId)
        },
        stopOfflineRunner: stopKeepOffline,
        stopExportRunner: async () => {
          if (userId) await stopExportUploads(userId)
        },
        clearLocalData,
        clearCache: () => {
          clearNotices()
          queryClient.clear()
        },
        toLogin: () => navigate({ to: '/login' }),
        pendingUploads: async () => {
          assertOwner()
          if (!userId) throw new Error('No signed-in owner')
          return countLocalUploadsForSignOut(db, userId)
        },
        pendingExports: async () => {
          assertOwner()
          if (!userId) throw new Error('No signed-in owner')
          return (await pendingExports(userId)).length
        },
        confirm,
      }),
  }
}
