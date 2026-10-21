import type { AbstractPowerSyncDatabase } from '@powersync/web'

/**
 * Changes a show's `settings` JSON text. The read and the write happen inside one write
 * transaction, so two changes made close together (a connector width, then its pattern) queue up and
 * the second one is built on the first one's result instead of on the text both of them read. The
 * latest stored text is what `transform` gets (not the possibly stale live query), so a change made
 * on another device is kept. Nothing is written when the show row is not in the local database.
 */
export async function updateShowSettings(
  db: Pick<AbstractPowerSyncDatabase, 'writeTransaction'>,
  showId: string,
  transform: (current: string | null) => string,
): Promise<void> {
  await db.writeTransaction(async (tx) => {
    const latest = await tx.getOptional<{ settings: string | null }>(
      'SELECT settings FROM shows WHERE id = ?',
      [showId],
    )
    if (!latest) return
    await tx.execute('UPDATE shows SET settings = ? WHERE id = ?', [
      transform(latest.settings ?? null),
      showId,
    ])
  })
}
