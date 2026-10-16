import { expect, type Page, test } from '@playwright/test'
import { readRun } from './env'
import { clickAt, type Line, lineOf, pageText, withUsers } from './markupHelpers'

/** The command palette (⌘K) on the short libretto: a cue number, a page, and the keys it keeps out. */
test.use({ viewport: { width: 1440, height: 1000 } })

const marker = (page: Page, id: string) => page.locator(`[data-cue-id="${id}"]`)

async function versionCueIds(page: Page): Promise<string[]> {
  const { libretto } = readRun()
  return page.evaluate(
    async (versionId) =>
      (
        (await window.__binder?.db.getAll<{ id: string }>(
          `SELECT id FROM cues WHERE json_extract(anchor, '$.documentVersionId') = ?`,
          [versionId],
        )) ?? []
      ).map((r) => r.id),
    libretto.versionId,
  )
}

/** Places an LX cue on a line of page 1 with the cue tool and returns its id, selected. */
async function placeLx(page: Page, line: Line): Promise<string> {
  await page.getByLabel('Active layer LX').check()
  const tool = page.getByRole('button', { name: 'Cue tool' })
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
  const before = await versionCueIds(page)
  await clickAt(page, 0, line.x, line.centre - 3)
  await expect.poll(async () => (await versionCueIds(page)).length).toBe(before.length + 1)
  const id = (await versionCueIds(page)).find((c) => !before.includes(c)) ?? ''
  await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
  return id
}

test('⌘K, a cue number, Enter: the cue is selected on its page', async ({ browser }) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    const { words } = await pageText(page, 0)
    const id = await placeLx(page, lineOf(words, 2))

    // A number no other spec uses, so the first result is this cue.
    const editor = page.getByRole('region', { name: 'Cue editor' })
    await editor.getByLabel('Number').fill('4321')
    await editor.getByLabel('Number').press('Enter')
    await editor.getByLabel('Label').fill('Palette probe')
    await editor.getByLabel('Label').press('Enter')
    await expect(editor.getByRole('heading')).toHaveText('LX 4321')

    // Nothing selected, focus on the page, then ⌘K (Ctrl+K here: either opens it).
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-cue-id][data-selected="true"]')).toHaveCount(0)
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('combobox')).toBeFocused()

    await palette.getByRole('combobox').fill('lx 4321')
    const current = palette.getByRole('option', { selected: true })
    await expect(current).toContainText('LX 4321')
    await expect(current).toContainText('Palette probe')
    await expect(current).toContainText('p.1')
    await expect(palette.getByText('Go to', { exact: true })).toBeVisible()
    await expect(palette.getByText('Actions', { exact: true })).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
    await expect(marker(page, id)).toBeInViewport()
    await expect(page.getByRole('region', { name: 'Cue editor' }).getByRole('heading')).toHaveText(
      'LX 4321',
    )

    // Remove the probe so the other specs' cue numbers stay theirs.
    await marker(page, id).focus()
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await versionCueIds(page)).includes(id)).toBe(false)
  })
})

test('a page number goes to that page; Escape closes and keeps the place', async ({ browser }) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await palette.getByRole('combobox').fill('3')
    await expect(palette.getByRole('option', { selected: true })).toContainText('Page')
    await expect(palette.getByRole('option', { selected: true })).toContainText('of 3')
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('3 / 3')

    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  })
})

test('while it is open, c and ] place and select nothing', async ({ browser }) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    const before = await versionCueIds(page)
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    // On the page behind (hovering it, so `c` would place) and in the box.
    await page.keyboard.type('c]c]')
    await expect(palette.getByRole('combobox')).toHaveValue('c]c]')
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
    expect(await versionCueIds(page)).toEqual(before)
    await expect(page.locator('[data-cue-id][data-selected="true"]')).toHaveCount(0)
  })
})

test('"In the script" opens Find on that text, once: closing it and pressing / opens it empty', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await palette.getByRole('combobox').fill('pirate')
    const row = palette.getByRole('option', { name: /contain/ })
    await expect(row).toContainText('pirate')
    await row.click()
    await expect(palette).toBeHidden()
    const find = page.getByRole('searchbox', { name: 'Search document' })
    await expect(find).toHaveValue('pirate')
    await expect(page.getByRole('status').filter({ hasText: /result/ })).toBeVisible()

    await find.press('Escape')
    await expect(find).toBeHidden()
    await page.keyboard.press('/')
    await expect(find).toBeVisible()
    await expect(find).toHaveValue('')
    await expect(find).toBeFocused()
    await expect(page.getByRole('list', { name: 'Search results' })).toHaveCount(0)
  })
})
