import { registerSW } from 'virtual:pwa-register'
import { pushNotice } from './components/noticeStore'

/**
 * Registers the service worker (production builds only; dev serves none). A new version waits
 * until the user accepts it, so a reload never swaps the code under a document they are reading.
 */
export function registerServiceWorker(): void {
  const update = registerSW({
    onNeedRefresh() {
      pushNotice({
        kind: 'info',
        message: 'A new version of Binder is ready.',
        action: { label: 'Reload', run: () => void update(true) },
      })
    },
  })
}
