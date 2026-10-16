import { expect, test } from '@playwright/test'
import { storageStateFor } from './env'
import {
  anchorOnLine,
  archiveShow,
  call,
  createRevisionShow,
  cueEntry,
  newRowId,
  type RevisionShow,
  signInAsOwner,
  syncUpload,
  uploadRevision,
  waitForVersion,
} from './revisionsHelpers'

test.use({ storageState: storageStateFor('owner'), viewport: { width: 1440, height: 1000 } })

/**
 * Versions with no network after a cold reload. This needs the service worker, so it runs against
 * the production build (playwright.offline.config.ts): the version switcher draws an older version
 * from the cached blobs and the local rows that still point at it, and compare works from the
 * cached PDFs and word layers of both versions.
 *
 * The show has a revision already, and one cue that still points at v1, as an offline client's cue
 * written after the revision would (placed on v1, uploaded late).
 */
let show: RevisionShow
let v2 = ''
const staleCue = newRowId()

test.beforeAll(async () => {
  test.setTimeout(240_000)
  show = await createRevisionShow('Revisions offline')
  const owner = await signInAsOwner()
  v2 = await uploadRevision(owner, show, 'V2 cuts')
  await waitForVersion(owner, show.showId, show.documentId, v2, { current: true })
  await syncUpload(owner, [
    cueEntry(show, {
      id: staleCue,
      departmentId: show.lxId,
      major: 10,
      label: 'Late cue',
      anchor: await anchorOnLine(owner, show, show.versionId, 'Strong his arm'),
    }),
  ])
})

test.afterAll(async () => {
  await archiveShow(show)
})

test('after a cold offline reload, the switcher shows v1 from cached blobs with local anchors only, compare works, and the late cue is re-anchored on reconnecting', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000)
  const docPath = `/shows/${show.showId}/docs/${show.documentId}`

  // Make both versions available offline: v1 and v2, each a pdf and a thumbnail and word layer
  // per page (3 pages), so 2 x (1 + 3 + 3) files.
  await page.goto(`/shows/${show.showId}`)
  await expect(page.getByRole('button', { name: 'Make available offline' })).toBeVisible({
    timeout: 30_000,
  })
  // The row's words say "v2 current" once v2 is ready and the cues have moved to it.
  await expect(
    page.getByRole('list', { name: 'Documents' }).locator('.version-status[data-status="ready"]'),
  ).toContainText('v2 current', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Make available offline' }).click()
  await expect(page.getByText('Available offline (14 files)')).toBeVisible({ timeout: 120_000 })

  await page.goto(docPath)
  const toolbar = page.getByRole('toolbar', { name: 'Viewer' })
  await expect(toolbar).toContainText('/ 3', { timeout: 30_000 })
  await expect(page.getByLabel('Version')).toHaveValue(v2)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
  await page.reload()
  await expect(toolbar).toContainText('/ 3', { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })

  // v1, offline: read-only, and the only anchors are the ones this device holds.
  await page.getByLabel('Version').selectOption(show.versionId)
  await expect(page.getByRole('status').filter({ hasText: 'Viewing v1 — read-only' })).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Showing local anchors only' }),
  ).toBeVisible()
  await expect(page.locator(`[data-cue-id="${staleCue}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Cue tool' })).toBeDisabled()
  await expect(page.locator('[data-page-index="0"] canvas')).toBeVisible()

  // Compare, offline: both versions' pages from cached bytes, and the cut lines tinted as removed.
  await page.getByRole('link', { name: 'Compare' }).click()
  await expect(page.getByRole('heading', { name: 'Compare versions' })).toBeVisible()
  const changes = page.getByRole('navigation', { name: 'Changes' })
  await expect(changes.getByRole('status')).toContainText(/\d+ removed, \d+ added/, {
    timeout: 60_000,
  })
  const removedCount = Number(
    /(\d+) removed/.exec((await changes.getByRole('status').textContent()) ?? '')?.[1],
  )
  expect(removedCount).toBeGreaterThanOrEqual(10)
  const cuts = changes.getByRole('button', { name: /lines? cut/ })
  expect(await cuts.count()).toBeGreaterThanOrEqual(1)
  await cuts.first().click()
  await expect(
    page
      .getByRole('region', { name: /^Old · v1/ })
      .locator('.compare-tint[data-op="removed"]')
      .first(),
  ).toBeVisible({ timeout: 30_000 })

  // Back online: the late cue is listed as on an older version, and Re-anchor moves it to v2.
  await context.setOffline(false)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true)
  await page.goto(`${docPath}?review=true`)
  const panel = page.getByRole('region', { name: 'Revision review' })
  const older = panel.locator('details.review-older')
  await expect(older.locator('summary')).toHaveText('On an older version · 1', { timeout: 60_000 })
  await older.locator('summary').click()
  const row = older.locator('li[data-review-item]')
  await expect(row.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Move' })).toBeEnabled()
  await row.getByRole('button', { name: 'Re-anchor' }).click()
  await expect(older).toHaveCount(0, { timeout: 30_000 })
  const review = await call<{ olderVersions: unknown[]; pending: { rowId: string }[] }>(
    await signInAsOwner(),
    'GET',
    `/api/documents/${show.documentId}/review`,
  )
  expect(review.olderVersions).toEqual([])
})
