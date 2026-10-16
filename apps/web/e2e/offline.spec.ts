import { FIXTURES } from '@binder/fixtures'
import { expect, type Page, test } from '@playwright/test'
import { APP_URL, readRun, storageStateFor } from './env'
import { hasInk, uploadAndWaitReady } from './helpers'
import {
  archiveShow,
  createRevisionShow,
  type RevisionShow,
  signInAsOwner,
  uploadRevision,
  waitForVersion,
} from './revisionsHelpers'

test.use({ storageState: storageStateFor('owner') })

/** The scan fixture has 8 pages and no text layer; processing runs OCR over it (about 15 s). */
const PAGES = 8

test('make available offline, go offline, reload, view and search', async ({ page, context }) => {
  test.setTimeout(300_000)
  const { sharedShow } = readRun()
  const title = `Offline scan ${Date.now()}`
  await uploadAndWaitReady(page, sharedShow.id, FIXTURES.scanPdf, title, 120_000)

  // Store the show's documents on this device (the button is in the show page's top bar).
  await page.goto(`/shows/${sharedShow.id}`)
  await page.getByRole('button', { name: 'Make available offline' }).click()
  await expect(page.getByText(/Available offline \(\d+ files\)/)).toBeVisible({ timeout: 120_000 })

  // The service worker has installed (precaching the shell and PDF.js) and controls the page.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  // Offline, and a cold reload: the app shell comes from the precache, the user from the device.
  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
  // Presence is silently absent offline: the reloaded app opens no socket.
  const sockets: string[] = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  await page.reload()
  const link = page.getByRole('list', { name: 'Documents' }).getByRole('link', { name: title })
  await expect(link).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'In the binder now' })).toHaveCount(0)

  // The document opens and its first page renders, from cached bytes.
  await link.click()
  const toolbar = page.getByRole('toolbar', { name: 'Viewer' })
  await expect(toolbar).toContainText(`1 / ${PAGES}`, { timeout: 30_000 })
  const page1 = page.locator('[data-page-index="0"] canvas')
  await expect(page1).toBeVisible()
  await expect.poll(() => hasInk(page1), { timeout: 15_000 }).toBe(true)
  const thumb = page.getByRole('navigation', { name: 'Thumbnails' }).getByRole('img').first()
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0)

  // Search works from the cached word layers, and a hit highlights its page.
  await page.getByRole('button', { name: 'Find in document' }).click()
  await page.getByRole('searchbox', { name: 'Search document' }).fill('pirate')
  const hits = page.getByRole('list', { name: 'Search results' }).getByRole('listitem')
  await expect(hits.first()).toBeVisible({ timeout: 30_000 })
  const last = hits.last().getByRole('button')
  const pageNumber = Number(/Page (\d+)/.exec((await last.textContent()) ?? '')?.[1])
  await last.click()
  await expect(toolbar).toContainText(`${pageNumber} / ${PAGES}`)
  const sheet = page.locator(`[data-page-index="${pageNumber - 1}"]`)
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('svg rect.search-hit').first()).toBeVisible()
  await expect.poll(() => hasInk(sheet.locator('canvas')), { timeout: 15_000 }).toBe(true)

  // Calling mode works from the same cache: the page, the strip and the keypad, offline, and the
  // status line says so as a calm state rather than an error.
  await page.getByRole('button', { name: 'Calling mode' }).click()
  const strip = page.getByRole('region', { name: 'Calling', exact: true })
  await expect(strip).toContainText(`p.${pageNumber} / ${PAGES}`)
  await expect(page.getByRole('region', { name: 'Calling status' })).toContainText(
    'offline, cached',
  )
  await expect(toolbar).toHaveCount(0)
  await expect.poll(() => hasInk(sheet.locator('canvas')), { timeout: 15_000 }).toBe(true)
  await page.keyboard.press('g')
  const keypad = page.getByRole('dialog', { name: 'Go to' })
  await keypad.getByRole('radio', { name: 'Page' }).click()
  await keypad.getByRole('button', { name: '1', exact: true }).click()
  await keypad.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(strip).toContainText(`p.1 / ${PAGES}`)
  const first = page.locator('[data-page-index="0"] canvas')
  await expect.poll(() => hasInk(first), { timeout: 15_000 }).toBe(true)
  await page.getByRole('button', { name: 'Exit' }).click()
  await expect(toolbar).toContainText(`1 / ${PAGES}`)

  // Still no presence socket, no presence UI, and no error shown for its absence.
  expect(sockets).toEqual([])
  await expect(page.getByRole('group', { name: /People on page/ })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test.describe('keep offline', () => {
  let show: RevisionShow

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    show = await createRevisionShow('Keep offline')
  })
  test.afterAll(async () => {
    await archiveShow(show)
  })

  /** Whether the Cache API holds a blob of this show whose URL contains `needle`. */
  const cached = (page: Page, needle: string) =>
    page.evaluate(async (n) => {
      const cache = await caches.open('blobs-v1')
      return (await cache.keys()).some((r) => r.url.includes(n))
    }, needle)
  const searchablePdf = (versionId: string) => `/versions/${versionId}/searchable.pdf`

  test.describe('a revision from another member', () => {
    // The LX editor watches; the owner (another user) uploads.
    test.use({ storageState: storageStateFor('lxEditor'), viewport: { width: 1440, height: 1000 } })

    test('with keep-offline On, a revision uploaded by another user is in the Cache within 30 s and opens offline; with it Off it is not', async ({
      page,
      context,
    }) => {
      test.setTimeout(420_000)
      const owner = await signInAsOwner()

      // On, from the overview's Offline card: the show's first version is stored.
      await page.goto(`/shows/${show.showId}`)
      const toggle = page.getByRole('switch', { name: 'Keep available offline' })
      await expect(toggle).toBeVisible({ timeout: 60_000 })
      await toggle.click()
      await expect(toggle).toBeChecked()
      await expect
        .poll(() => cached(page, searchablePdf(show.versionId)), { timeout: 60_000 })
        .toBe(true)
      // The service worker controls the page, for the offline reload below.
      await page.evaluate(() => navigator.serviceWorker.ready)
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true)

      // Another user uploads a revision. Nobody on this page asks for it: once it is ready and
      // synced, Binder stores it (within 30 s) and its page layers.
      const v2 = await uploadRevision(owner, show, 'V2 cuts')
      await waitForVersion(owner, show.showId, show.documentId, v2, { current: true })
      await expect.poll(() => cached(page, searchablePdf(v2)), { timeout: 30_000 }).toBe(true)
      await expect
        .poll(() => cached(page, `/versions/${v2}/pages/0/words.json`), { timeout: 30_000 })
        .toBe(true)

      // It opens with no network, from what was stored.
      await context.setOffline(true)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
      await page.goto(`/shows/${show.showId}/docs/${show.documentId}`)
      const page1 = page.locator('[data-page-index="0"] canvas')
      await expect(page1).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => hasInk(page1), { timeout: 15_000 }).toBe(true)
      await expect(page.getByRole('alert')).toHaveCount(0)
      await context.setOffline(false)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true)

      // Off: the next revision is not stored (what is cached stays).
      await page.goto(`/shows/${show.showId}`)
      await expect(toggle).toBeChecked({ timeout: 30_000 })
      await toggle.click()
      await expect(toggle).not.toBeChecked()
      const v3 = await uploadRevision(owner, show, 'V3 cuts')
      await waitForVersion(owner, show.showId, show.documentId, v3, { current: true })
      await expect(
        page
          .getByRole('list', { name: 'Documents' })
          .locator('.version-status[data-status="ready"]'),
      ).toContainText('v3 current', { timeout: 60_000 })
      // Past the runner's 2 s settle and a fetch that would have followed it.
      await page.waitForTimeout(8_000)
      expect(await cached(page, searchablePdf(v3))).toBe(false)
      expect(await cached(page, searchablePdf(v2))).toBe(true)
    })
  })

  test.describe('signing out', () => {
    // A session of its own, so signing out does not end the one the other specs share. It runs on
    // the dev origin, because the API's auth only trusts that origin for sign-in and sign-out.
    test.use({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1440, height: 1000 },
    })

    test('after sign-out and sign-in the switch is Off', async ({ page }) => {
      test.setTimeout(180_000)
      const { users, password } = readRun()
      const signIn = async () => {
        await page.goto(`${APP_URL}/login`)
        await page.getByLabel('Email').fill(users.owner.email)
        await page.getByLabel('Password').fill(password)
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Shows' })).toBeVisible()
        await page.goto(`${APP_URL}/shows/${show.showId}`)
        return page.getByRole('switch', { name: 'Keep available offline' })
      }

      const first = await signIn()
      await expect(first).toBeVisible({ timeout: 60_000 })
      await first.click()
      await expect(first).toBeChecked()

      await page.getByRole('button', { name: 'Account menu' }).first().click()
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })

      const second = await signIn()
      await expect(second).toBeVisible({ timeout: 60_000 })
      await expect(second).not.toBeChecked()
    })
  })
})
