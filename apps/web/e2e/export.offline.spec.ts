import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { API_URL, APP_URL, readRun, storageStateFor } from './env'

test.use({ storageState: storageStateFor('owner'), viewport: { width: 1440, height: 1000 } })

/**
 * Printing with no network after a cold reload. This needs the service worker, so it runs against
 * the production build (playwright.offline.config.ts): the stamping code (its own chunk) must come
 * from the precache, the script PDF from the blob cache, and the outbox from IndexedDB.
 */
test('after a cold offline reload, print downloads at once and the record is made on reconnecting', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000)
  const { sharedShow, libretto } = readRun()
  const docPath = `/shows/${sharedShow.id}/docs/${libretto.documentId}`

  await page.goto(`/shows/${sharedShow.id}/exports`)
  await expect(page.getByRole('heading', { name: 'Exports' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Sync status')).toHaveText('Synced', { timeout: 30_000 })
  const records = page.locator('li[data-export-id]')
  const before = await records.count()

  // Open the script once online, so its PDF is stored, and wait for the service worker to control the page.
  await page.goto(docPath)
  const toolbar = page.getByRole('toolbar', { name: 'Viewer' })
  await expect(toolbar).toContainText('1 / 3', { timeout: 30_000 })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
  await page.reload()
  await expect(toolbar).toContainText('1 / 3', { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })

  // The same print as the online spec's: pages 2–3 on Letter, with a name of its own.
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print' })
  await dialog.getByRole('button', { name: 'Calling script: all layers' }).click()
  await dialog.getByRole('radio', { name: 'Range' }).click()
  await dialog.getByLabel('Page range').fill('2-3')
  await dialog.getByRole('radio', { name: 'Letter' }).click()
  const printName = `offline-range-${Date.now()}`
  await dialog.getByLabel('File name').fill(printName)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PDF' }).click(),
  ])
  const saved = join(testInfo.outputDir, 'offline-print.pdf')
  await download.saveAs(saved)
  expect(download.suggestedFilename()).toBe(`${printName}.pdf`)
  expect(readFileSync(saved).subarray(0, 5).toString()).toBe('%PDF-')
  const printed = await PDFDocument.load(readFileSync(saved))
  expect(printed.getPageCount()).toBe(2)
  expect(printed.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
  await expect(dialog).toBeHidden()

  // Still offline: the export waits in the outbox, and a reload does not lose it.
  await page.goto(`/shows/${sharedShow.id}/exports`)
  const waiting = page.getByRole('region', { name: 'Waiting to upload' })
  await expect(waiting).toContainText(download.suggestedFilename(), { timeout: 30_000 })

  await context.setOffline(false)
  await expect(records).toHaveCount(before + 1, { timeout: 60_000 })
  await expect(waiting).toHaveCount(0, { timeout: 30_000 })

  // The record that was made on reconnecting carries the options the print was made with.
  const { users, password } = readRun()
  const signedIn = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ email: users.owner.email, password }),
  })
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const listed = await fetch(`${API_URL}/api/shows/${sharedShow.id}/exports`, {
    headers: { cookie, origin: APP_URL },
  })
  const { exports: stored } = (await listed.json()) as {
    exports: Array<{ filename: string; options: Record<string, unknown> | null }>
  }
  expect(stored.find((r) => r.filename === `${printName}.pdf`)?.options).toMatchObject({
    pages: '2-3',
    paper: 'Letter',
    includeStandbyWarn: true,
    includeAnnotations: true,
    includeCueNotes: true,
  })
})

/**
 * A cue sheet with no network after a cold reload: the XLSX writer is a lazy chunk (fflate), so it
 * must come from the precache, and the rows from the local database.
 */
test('after a cold offline reload, the cue list exports an XLSX at once and its record is made on reconnecting', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000)
  const { sharedShow } = readRun()
  await page.goto(`/shows/${sharedShow.id}/exports`)
  await expect(page.getByRole('heading', { name: 'Exports' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Sync status')).toHaveText('Synced', { timeout: 30_000 })
  const records = page.locator('li[data-export-id]')
  const before = await records.count()

  await page.goto(`/shows/${sharedShow.id}/cues`)
  await expect(page.getByRole('heading', { name: /cue list$/ })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
  await page.reload()
  await expect(page.getByRole('heading', { name: /cue list$/ })).toBeVisible({ timeout: 30_000 })

  // The formats sit behind the top bar's Export button.
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const group = page.getByRole('group', { name: 'Export cue sheet' })
  // The list may hold no cues in this show; the sheet is still made (header only).
  await expect(group).toBeVisible()
  const exportButton = group.getByRole('button', { name: 'XLSX' })
  await expect(exportButton).toBeEnabled({ timeout: 20_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  const saved = join(testInfo.outputDir, 'offline-sheet.xlsx')
  await download.saveAs(saved)
  expect(readFileSync(saved).subarray(0, 2).toString()).toBe('PK')

  await page.goto(`/shows/${sharedShow.id}/exports`)
  const waiting = page.getByRole('region', { name: 'Waiting to upload' })
  await expect(waiting).toContainText(download.suggestedFilename(), { timeout: 30_000 })

  await context.setOffline(false)
  await expect(records).toHaveCount(before + 1, { timeout: 60_000 })
  await expect(waiting).toHaveCount(0, { timeout: 30_000 })
})
