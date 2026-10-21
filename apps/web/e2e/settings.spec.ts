import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib'
import { readRun, storageStateFor } from './env'
import { clickAt, lineOf, pageText, withUsers, zoomOutTo } from './markupHelpers'

test('an owner manages departments and member scope; an editor sees them read-only', async ({
  browser,
}) => {
  const { sharedShow, users } = readRun()
  const url = `/shows/${sharedShow.id}/settings`
  const a = await (await browser.newContext({ storageState: storageStateFor('owner') })).newPage()
  const b = await (
    await browser.newContext({ storageState: storageStateFor('sndEditor') })
  ).newPage()
  await a.goto(url)
  await b.goto(url)

  const departments = (page: typeof a) => page.getByRole('list', { name: 'Departments' })
  const row = (page: typeof a, code: string) =>
    departments(page).getByRole('listitem').filter({ hasText: code })

  // Seeded departments reach both users through sync.
  for (const code of ['LX', 'SND', 'TM', 'VID', 'SM', 'STG', 'FLY']) {
    await expect(row(a, code)).toBeVisible({ timeout: 20_000 })
    await expect(row(b, code)).toBeVisible({ timeout: 20_000 })
  }
  await expect(b.getByText('Only the owner can change these.')).toBeVisible()
  await expect(b.getByRole('button', { name: 'Archive show' })).toHaveCount(0)
  await expect(b.getByRole('form', { name: 'Add department' })).toHaveCount(0)
  await expect(a.getByRole('form', { name: 'Add department' })).toBeVisible()

  // Owner adds PYRO (the code is upper-cased) and hides VID; the editor sees both change.
  const add = a.getByRole('form', { name: 'Add department' })
  await add.getByLabel('New department code').fill('pyro')
  await add.getByLabel('New department name').fill('Pyrotechnics')
  await add.getByRole('button', { name: 'Add department' }).click()
  await expect(row(a, 'PYRO')).toBeVisible({ timeout: 10_000 })
  await expect(row(b, 'PYRO')).toBeVisible({ timeout: 10_000 })
  // The box follows the synced row, so it flips once the change comes back: click, then wait.
  await row(a, 'VID').getByLabel('Hidden').click()
  await expect(row(a, 'VID').getByLabel('Hidden')).toBeChecked({ timeout: 10_000 })
  await expect(row(b, 'VID')).toContainText('hidden', { timeout: 10_000 })
  // A duplicate code is refused with the server's message.
  await add.getByLabel('New department code').fill('LX')
  await add.getByLabel('New department name').fill('Again')
  await add.getByRole('button', { name: 'Add department' }).click()
  await expect(add.getByRole('alert')).toContainText('already exists')

  // The editor starts scoped to SND (global setup). Owner grants every department, then scopes
  // the editor back to SND only.
  const bobRow = a
    .getByRole('list', { name: 'Members' })
    .getByRole('listitem')
    .filter({ hasText: users.sndEditor.name })
  await expect(bobRow).toBeVisible()
  await expect(bobRow.getByLabel('All departments')).not.toBeChecked()
  await bobRow.getByLabel('All departments').click()
  await expect(bobRow.getByLabel('All departments')).toBeChecked()
  await expect(bobRow.getByLabel('SND', { exact: true })).toHaveCount(0)
  await bobRow.getByLabel('All departments').click()
  await bobRow.getByLabel('SND', { exact: true }).click()
  await expect(bobRow.getByLabel('SND', { exact: true })).toBeChecked()
  await bobRow.getByLabel('LX', { exact: true }).click()
  await expect(bobRow.getByLabel('SND', { exact: true })).toBeChecked()
  await expect(bobRow.getByLabel('LX', { exact: true })).not.toBeChecked()
  // The last department cannot be unticked (that would widen the scope), and says why.
  await expect(bobRow.getByLabel('SND', { exact: true })).toBeDisabled()
  await expect(bobRow).toContainText("choose 'All departments'")

  await b.reload()
  await expect(
    b
      .getByRole('list', { name: 'Members' })
      .getByRole('listitem')
      .filter({ hasText: users.sndEditor.name }),
  ).toContainText('SND', { timeout: 20_000 })
  // The editor's page shows no controls.
  await expect(b.getByRole('combobox', { name: /role$/ })).toHaveCount(0)
})

test('the owner picks the paper size for cue sheets; another member sees it read-only and it reaches them', async ({
  browser,
}) => {
  const { sharedShow } = readRun()
  const url = `/shows/${sharedShow.id}/settings`
  const a = await (await browser.newContext({ storageState: storageStateFor('owner') })).newPage()
  const b = await (
    await browser.newContext({ storageState: storageStateFor('sndEditor') })
  ).newPage()
  await a.goto(url)
  await b.goto(url)
  const paper = a.getByLabel('Paper size')
  try {
    await expect(paper).toHaveValue('A4', { timeout: 20_000 })
    await expect(b.getByLabel('Paper size')).toHaveCount(0)
    await expect(b.getByText('A4 (210 × 297 mm)')).toBeVisible({ timeout: 20_000 })

    await paper.selectOption('Letter')
    await expect(b.getByText('Letter (8.5 × 11 in)')).toBeVisible({ timeout: 20_000 })
    // Other settings are not lost: the stamp set is still the seven defaults.
    await expect(a.getByRole('list', { name: 'Stamps' }).getByRole('listitem')).toHaveCount(7)
  } finally {
    await paper.selectOption('A4')
    await expect(b.getByText('A4 (210 × 297 mm)')).toBeVisible({ timeout: 20_000 })
  }
})

/** Waits until every local write of this page has gone up to the server. */
async function uploaded(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (await window.__binder?.db.get<{ n: number }>('SELECT count(*) AS n FROM ps_crud'))
              ?.n ?? -1,
        ),
      { timeout: 20_000 },
    )
    .toBe(0)
}

/** The show's settings text as this page's local database holds it. */
const localSettings = (page: Page, showId: string) =>
  page.evaluate(
    async (id) =>
      (
        await window.__binder?.db.get<{ settings: string | null }>(
          'SELECT settings FROM shows WHERE id = ?',
          [id],
        )
      )?.settings ?? null,
    showId,
  )

/** Page 1 of an exported PDF: its content stream operators as text. */
async function firstPageContent(bytes: Buffer): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const contents = doc.getPages()[0]?.node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents]
  let text = ''
  for (const entry of streams) {
    const stream = entry && doc.context.lookup(entry)
    if (stream instanceof PDFRawStream)
      text += `${Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')}\n`
  }
  return text
}

test('an owner gives SND a bold dashed connector: the page draws it, the export prints it, other departments are unchanged, and a member reads it', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const { sharedShow, libretto } = readRun()
  const settingsUrl = `/shows/${sharedShow.id}/settings`
  const docUrl = `/shows/${sharedShow.id}/docs/${libretto.documentId}`
  const work = mkdtempSync(join(tmpdir(), 'binder-connector-e2e-'))
  const cueIds: string[] = []
  const leaderOf = (page: Page, id: string) =>
    page.locator(`[data-cue-trigger="${id}"] polyline.cue-leader`)
  const versionCueIds = (page: Page) =>
    page.evaluate(
      async (versionId) =>
        (
          (await window.__binder?.db.getAll<{ id: string }>(
            `SELECT id FROM cues WHERE json_extract(anchor, '$.documentVersionId') = ?`,
            [versionId],
          )) ?? []
        ).map((r) => r.id),
      libretto.versionId,
    )
  /** Places an underline cue on the department's layer at a line of page 1 and returns its id. */
  const place = async (page: Page, department: string, lineNo: number): Promise<string> => {
    const before = await versionCueIds(page)
    await page.getByLabel(`Active layer ${department}`).check()
    const tool = page.getByRole('button', { name: 'Cue tool' })
    if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
    await page.getByLabel('Cue mark').selectOption('underline')
    const { words } = await pageText(page, 0)
    const line = lineOf(words, lineNo)
    await clickAt(page, 0, line.x, line.centre - 3)
    await expect.poll(async () => (await versionCueIds(page)).length).toBe(before.length + 1)
    const id = (await versionCueIds(page)).find((c) => !before.includes(c)) ?? ''
    cueIds.push(id)
    await expect(page.locator(`[data-cue-id="${id}"]`)).toHaveAttribute('data-selected', 'true')
    return id
  }
  const departmentRow = (page: Page, code: string) =>
    page.getByRole('list', { name: 'Departments' }).getByRole('listitem').filter({ hasText: code })

  const member = await (
    await browser.newContext({ storageState: storageStateFor('sndEditor') })
  ).newPage()
  try {
    await withUsers(browser, ['owner'], async ([a]) => {
      const { page } = a
      const original = await localSettings(page, sharedShow.id)
      try {
        // The owner sets SND to bold and dashed on the settings page; LX is left alone.
        await page.goto(settingsUrl)
        const width = page.getByRole('radiogroup', { name: 'SND connector width' })
        await expect(width).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('radiogroup', { name: 'SND connector pattern' })).toBeVisible()
        await expect(
          page
            .getByRole('radiogroup', { name: 'LX connector width' })
            .getByRole('radio', { name: 'Thin' }),
        ).toHaveAttribute('aria-checked', 'true')
        await width.getByRole('radio', { name: 'Bold' }).click()
        await expect(width.getByRole('radio', { name: 'Bold' })).toHaveAttribute(
          'aria-checked',
          'true',
        )
        const pattern = page.getByRole('radiogroup', { name: 'SND connector pattern' })
        await pattern.getByRole('radio', { name: 'Dashed' }).click()
        await expect(pattern.getByRole('radio', { name: 'Dashed' })).toHaveAttribute(
          'aria-checked',
          'true',
        )
        await uploaded(page)

        // It survives a reload, and the other settings are not lost.
        await page.reload()
        await expect(
          page
            .getByRole('radiogroup', { name: 'SND connector width' })
            .getByRole('radio', { name: 'Bold' }),
        ).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
        await expect(
          page
            .getByRole('radiogroup', { name: 'SND connector pattern' })
            .getByRole('radio', { name: 'Dashed' }),
        ).toHaveAttribute('aria-checked', 'true')
        await expect(
          page
            .getByRole('radiogroup', { name: 'LX connector pattern' })
            .getByRole('radio', { name: 'Solid' }),
        ).toHaveAttribute('aria-checked', 'true')
        expect(await localSettings(page, sharedShow.id)).toContain('"connectorStyles"')

        // A member who is not the owner reads the same values as words, with no controls.
        await member.goto(settingsUrl)
        await expect(departmentRow(member, 'SND')).toContainText('Bold', { timeout: 20_000 })
        await expect(departmentRow(member, 'SND')).toContainText('Dashed')
        await expect(departmentRow(member, 'LX')).toContainText('Thin')
        await expect(departmentRow(member, 'LX')).toContainText('Solid')
        await expect(member.getByRole('radiogroup', { name: /connector/ })).toHaveCount(0)

        // The script page draws SND's connector at 2.5 pt with a dash; LX's stays 0.75 pt and solid.
        await page.goto(docUrl)
        await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('/ 3', {
          timeout: 30_000,
        })
        await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible()
        await zoomOutTo(page)
        const snd = await place(page, 'SND', 2)
        const lx = await place(page, 'LX', 6)
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await page.keyboard.press('Escape')
        const check = async () => {
          const sndLeader = leaderOf(page, snd)
          await expect(sndLeader).toHaveAttribute('stroke-width', '2.5')
          expect(await sndLeader.getAttribute('stroke-dasharray')).toMatch(/^10 6\.25$/)
          expect(await sndLeader.getAttribute('stroke-linecap')).toBeNull()
          const lxLeader = leaderOf(page, lx)
          await expect(lxLeader).toHaveAttribute('stroke-width', '0.75')
          expect(await lxLeader.getAttribute('stroke-dasharray')).toBeNull()
        }
        await check()
        await uploaded(page)
        await page.reload()
        await expect(page.locator(`[data-cue-id="${snd}"]`)).toBeVisible({ timeout: 30_000 })
        await check()

        // The exported PDF prints the same: SND's line is 2.5 pt with a 10 on, 6.25 off dash.
        await page.getByRole('button', { name: 'Print', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Print' })
        await dialog.getByRole('button', { name: 'Calling script: all layers' }).click()
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          dialog.getByRole('button', { name: 'Download PDF' }).click(),
        ])
        await expect(dialog).toBeHidden()
        const saved = join(work, 'connectors.pdf')
        await download.saveAs(saved)
        const content = await firstPageContent(readFileSync(saved))
        expect(content).toMatch(/(^|\s)2\.5 w(\s|$)/)
        expect(content).toMatch(/\[\s*10\s+6\.25\s*\]\s*0\s+d/)
        expect(content).toMatch(/(^|\s)0\.75 w(\s|$)/)
      } finally {
        // Take the probe cues off the shared show and put its settings back as they were.
        if (cueIds.length) {
          await page.getByRole('button', { name: 'Select', exact: true }).click()
          for (const id of cueIds) {
            if (!(await versionCueIds(page)).includes(id)) continue
            await page.locator(`[data-cue-id="${id}"]`).click()
            await page.keyboard.press('Delete')
            await expect.poll(async () => (await versionCueIds(page)).includes(id)).toBe(false)
          }
        }
        await page.evaluate(
          async ({ id, settings }) => {
            await window.__binder?.db.execute('UPDATE shows SET settings = ? WHERE id = ?', [
              settings,
              id,
            ])
          },
          { id: sharedShow.id, settings: original },
        )
        await uploaded(page)
      }
    })
  } finally {
    await member.context().close()
    rmSync(work, { recursive: true, force: true })
  }
})
