import { activateLocalUser } from '../auth/localWork'

/** A synthetic, verified account fixture; transitions are explicit in multi-account tests. */
export function claimTestAccount(userId: string): void {
  localStorage.setItem('binder.localDbOwner', userId)
  localStorage.setItem('binder.localDbClaim', `test-claim-${userId}`)
  localStorage.setItem('binder.localDbDevice', `test-retry-${userId}`)
  activateLocalUser(userId)
}
