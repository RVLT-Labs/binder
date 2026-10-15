import { expect, type Locator, type Page } from '@playwright/test'

/** True once the canvas holds something other than white paper. */
export const hasInk = (canvas: Locator) =>
  canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')
    if (!ctx || el.width === 0) return false
    const { data } = ctx.getImageData(0, 0, el.width, el.height)
    for (let i = 0; i < data.length; i += 4) if (data[i] < 200) return true
    return false
  })

/**
 * Uploads a PDF to the show through the dialog, as an owner or editor, and returns the document's
 * row in the list once processing finishes (`readyTimeout` ms).
 */
export async function uploadAndWaitReady(
  page: Page,
  showId: string,
  file: string,
  title: string,
  readyTimeout: number,
): Promise<Locator> {
  await page.goto(`/shows/${showId}`)
  await page.getByRole('button', { name: 'Upload document' }).click()
  const dialog = page.getByRole('dialog', { name: 'Upload document' })
  await dialog.getByLabel('PDF file').setInputFiles(file)
  await dialog.getByLabel('Kind').selectOption('libretto')
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  // The list follows the synced version row through processing to ready.
  const row = page
    .getByRole('list', { name: 'Documents' })
    .getByRole('listitem')
    .filter({ hasText: title })
  await expect(row).toContainText(/queued|processing|ready/, { timeout: 20_000 })
  await expect(row).toContainText('ready', { timeout: readyTimeout })
  return row
}

/** A destination in the app shell's rail (Script, Cues, Docs, Activity, Exports). */
export const railLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Binder' }).getByRole('link', { name, exact: true })

/** The show's title in the top bar's breadcrumbs, a link back to the show on every screen inside it. */
export const showCrumb = (page: Page, title: string) =>
  page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: title, exact: true })
