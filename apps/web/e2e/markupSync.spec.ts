import { randomUUID } from 'node:crypto'
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { readRun, storageStateFor, type UserKey } from './env'

/** A signed-in page whose local database has synced the shared show's departments. */
async function open(browser: Browser, user: UserKey, contexts: BrowserContext[]) {
  const context = await browser.newContext({ storageState: storageStateFor(user) })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto('/')
  await page.waitForFunction(() => window.__binder !== undefined)
  const { sharedShow } = readRun()
  await expect
    .poll(() => count(page, 'SELECT id FROM departments WHERE show_id = ?', sharedShow.id), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0)
  return { context, page }
}

/** Rows matching `sql` in the page's local database. */
function count(page: Page, sql: string, param: string): Promise<number> {
  return page.evaluate(
    async ({ sql, param }) => (await window.__binder?.db.getAll(sql, [param]))?.length ?? -1,
    { sql, param },
  )
}

const cueCount = (page: Page, id: string) => count(page, 'SELECT id FROM cues WHERE id = ?', id)

/** Inserts a cue into the local database, as the markup tools will; PowerSync queues it as a PUT. */
function insertCue(
  page: Page,
  cue: { id: string; showId: string; departmentId: string; major: number; label: string },
) {
  return page.evaluate(async (c) => {
    const now = new Date().toISOString()
    await window.__binder?.db.execute(
      `INSERT INTO cues (id, show_id, department_id, major, minor, label, anchor, type, notes,
                         colour, payload, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, 0, ?, NULL, 'go', '', NULL, '{}', ?, ?, NULL)`,
      [c.id, c.showId, c.departmentId, c.major, c.label, now, now],
    )
  }, cue)
}

test('a cue created offline uploads on reconnect and reaches the other user', async ({
  browser,
}) => {
  const { sharedShow, departments } = readRun()
  const contexts: BrowserContext[] = []
  try {
    const a = await open(browser, 'owner', contexts)
    const b = await open(browser, 'sndEditor', contexts)
    await expect(a.page.getByLabel('Sync status')).toHaveText('Synced', { timeout: 20_000 })

    const id = randomUUID()
    await a.context.setOffline(true)
    await insertCue(a.page, {
      id,
      showId: sharedShow.id,
      departmentId: departments.LX,
      major: 21,
      label: 'Offline sunrise',
    })
    expect(await cueCount(a.page, id)).toBe(1)
    await expect(a.page.getByLabel('Sync status')).toHaveText('Offline')
    await expect(a.page.getByLabel('Sync status')).toHaveAttribute('data-pending', '1')
    await expect(a.page.getByRole('status').filter({ hasText: 'waiting to sync' })).toContainText(
      '1 waiting to sync',
    )
    // Long enough for an upload attempt and retry: B must still not have it.
    await b.page.waitForTimeout(3_000)
    expect(await cueCount(b.page, id)).toBe(0)

    await a.context.setOffline(false)
    await expect.poll(() => cueCount(b.page, id), { timeout: 10_000 }).toBe(1)
    const [row] = await b.page.evaluate(
      async (cueId) =>
        (await window.__binder?.db.getAll<{ label: string; major: number; department_id: string }>(
          'SELECT label, major, department_id FROM cues WHERE id = ?',
          [cueId],
        )) ?? [],
      id,
    )
    expect(row).toEqual({ label: 'Offline sunrise', major: 21, department_id: departments.LX })
    await expect(a.page.getByLabel('Sync status')).toHaveText('Synced', { timeout: 10_000 })
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('an out-of-scope create is rejected, named, and disappears locally', async ({ browser }) => {
  const { sharedShow, departments } = readRun()
  const contexts: BrowserContext[] = []
  try {
    const a = await open(browser, 'owner', contexts)
    const b = await open(browser, 'sndEditor', contexts)

    // B edits SND only, so an LX cue is refused by the server.
    const id = randomUUID()
    await insertCue(b.page, {
      id,
      showId: sharedShow.id,
      departmentId: departments.LX,
      major: 33,
      label: 'Not mine',
    })
    expect(await cueCount(b.page, id)).toBe(1)
    const notice = b.page.getByRole('alert').filter({ hasText: 'was not saved' })
    await expect(notice).toContainText('LX cue 33', { timeout: 10_000 })
    await expect(notice).toContainText('was not saved')
    await expect.poll(() => cueCount(b.page, id), { timeout: 10_000 }).toBe(0)
    expect(await cueCount(a.page, id)).toBe(0)
  } finally {
    for (const context of contexts) await context.close()
  }
})
