import type { AbstractPowerSyncDatabase } from '@powersync/web'

/**
 * The status a show takes when it comes out of the archive. The screens only tell Active from
 * Archived, so prep, rehearsal and running look the same; prep is the plainest way back.
 */
export const REACTIVATED_STATUS = 'prep'

/**
 * Bring an archived show back: a local show write that PowerSync queues and uploads. The server
 * applies it only for an owner (an archived show refuses every other change), so callers offer it
 * to owners alone.
 */
export function reactivateShow(db: Pick<AbstractPowerSyncDatabase, 'execute'>, showId: string) {
  return db.execute('UPDATE shows SET status = ? WHERE id = ?', [REACTIVATED_STATUS, showId])
}
