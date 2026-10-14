import type { PowerSyncDatabase } from '@powersync/web'

declare global {
  interface Window {
    /** Development builds only: the local database, for the e2e suite to write to it directly. */
    __binder?: { db: PowerSyncDatabase }
  }
}

/** Exposes the local database on `window.__binder` in development; a no-op in production builds. */
export function installDevHooks(db: PowerSyncDatabase): void {
  if (import.meta.env.DEV) window.__binder = { db }
}
