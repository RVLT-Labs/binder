import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURES } from '@binder/fixtures'
import { expect, type Page, test } from '@playwright/test'
import { writeBlankScanPdf } from '../../api/test/scanHelpers'
import { readRun, storageStateFor } from './env'
import { railLink } from './helpers'

/**
 * Processing controls on the Documents screen: a file Binder cannot read says why and can be
 * removed, and an upload that is cancelled can be tried again. The spec uploads into the run's
 * shared show with titles of its own.
 */
test.use({ storageState: storageStateFor('owner'), viewport: { width: 1280, height: 800 } })

async function upload(page: Page, showId: string, file: string, title: string) {
  await page.goto(`/shows/${showId}`)
  await page.getByRole('button', { name: 'Upload document' }).click()
  const dialog = page.getByRole('dialog', { name: 'Upload document' })
  await dialog.getByLabel('PDF file').setInputFiles(file)
  await dialog.getByLabel('Kind').selectOption('libretto')
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await railLink(page, 'Docs').click()
  return page.getByRole('list', { name: 'Documents' }).getByRole('listitem').filter({
    hasText: title,
  })
}

test('uploading a 72 dpi scan shows "couldn’t read text" with the dpi copy and Remove clears the row', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const { sharedShow } = readRun()
  const scan = join(mkdtempSync(join(tmpdir(), 'binder-e2e-')), 'blocking-notes.pdf')
  writeBlankScanPdf(scan, 72)
  const title = `Blocking notes ${Date.now()}`
  const row = await upload(page, sharedShow.id, scan, title)

  const status = row.locator('.version-status')
  await expect(status).toHaveAttribute('data-status', 'failed', { timeout: 60_000 })
  await expect(status).toHaveText('couldn’t read text')
  await expect(row).toContainText(
    'Scanned at 72 dpi, so there is no text to search or anchor to. Try a 300 dpi scan. Or remove this upload, then upload the file again as a new document with Text recognition set to Never, and mark it up by position.',
  )
  await expect(row.getByRole('button', { name: 'Try again' })).toBeVisible()

  // A damaged-file style failure cannot succeed on a rerun, so Try again opens the upload instead.
  await row.getByRole('button', { name: 'Try again' }).click()
  const again = page.getByRole('dialog', { name: `New version of ${title}` })
  await expect(again).toBeVisible()
  await again.getByRole('button', { name: 'Cancel' }).click()
  await expect(again).toBeHidden()

  // Remove asks first, then deletes the version and the document it was the only version of.
  await row.getByRole('button', { name: 'Remove' }).click()
  const confirm = page.getByRole('dialog', { name: 'Remove upload' })
  await expect(confirm).toContainText(`Remove ${title}? The file and its record go.`)
  await confirm.getByRole('button', { name: 'Remove' }).click()
  await expect(row).toHaveCount(0, { timeout: 20_000 })
})

test('cancelling a big upload turns the row to Cancelled and Try again completes it', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const { sharedShow } = readRun()
  const title = `Big scan ${Date.now()}`
  // The 8-page scan needs OCR, which takes long enough to stop it part of the way.
  const row = await upload(page, sharedShow.id, FIXTURES.scanPdf, title)

  const status = row.locator('.version-status')
  await expect(status).toHaveAttribute('data-status', /queued|processing/, { timeout: 30_000 })
  await expect(row).toContainText(/MB uploaded|KB uploaded/)
  await row.getByRole('button', { name: 'Cancel' }).click()

  await expect(status).toHaveAttribute('data-status', 'failed', { timeout: 20_000 })
  await expect(status).toHaveText('cancelled')
  await expect(row).toContainText('Cancelled. The file is still here if you want to try again.')

  // A cancelled upload is retried in place, from the stored file.
  await row.getByRole('button', { name: 'Try again' }).click()
  await expect(status).toHaveAttribute('data-status', /queued|processing|ready/, {
    timeout: 20_000,
  })
  await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 150_000 })
})
