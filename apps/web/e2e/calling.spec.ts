import { expect, type Page, test } from '@playwright/test'
import { readRun, storageStateFor } from './env'
import { clickAt, type Line, lineOf, pageText, withUsers } from './markupHelpers'

/** Calling mode (DESIGN §9) and the script top bar's "…" menu, on the short libretto. */
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

/** Places an LX cue on a line of page 1 with the cue tool, numbered 4322 with a label, and returns its id. */
async function placeProbe(page: Page, line: Line): Promise<string> {
  await page.getByLabel('Active layer LX').check()
  const tool = page.getByRole('button', { name: 'Cue tool' })
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
  const before = await versionCueIds(page)
  await clickAt(page, 0, line.x, line.centre - 3)
  await expect.poll(async () => (await versionCueIds(page)).length).toBe(before.length + 1)
  const id = (await versionCueIds(page)).find((c) => !before.includes(c)) ?? ''
  await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
  const editor = page.getByRole('region', { name: 'Cue editor' })
  await editor.getByLabel('Number').fill('4322')
  await editor.getByLabel('Number').press('Enter')
  await editor.getByLabel('Label').fill('Calling probe')
  await editor.getByLabel('Label').press('Enter')
  await expect(editor.getByRole('heading')).toHaveText('LX 4322')
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  return id
}

test('Calling mode: no tools, ← → turn pages, the keypad jumps to a cue, Exit returns to the same page', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    const docUrl = page.url().split('?')[0]
    let id = ''
    try {
      const { words } = await pageText(page, 0)
      id = await placeProbe(page, lineOf(words, 2))
      await page.keyboard.press('Escape')
      const before = await versionCueIds(page)

      // A Find card left open does not come along into Calling.
      await page.getByRole('button', { name: 'Find in document' }).click()
      await expect(page.getByRole('searchbox', { name: 'Search document' })).toBeVisible()

      // From the top bar. Markup's own controls go; the page and the strip stay.
      await page.getByRole('button', { name: 'Calling mode' }).click()
      await expect(page).toHaveURL(/[?&]mode=calling(&|$)/)
      const strip = page.getByRole('region', { name: 'Calling', exact: true })
      await expect(strip).toBeVisible()
      await expect(page.getByRole('searchbox', { name: 'Search document' })).toHaveCount(0)
      await expect(
        page.getByRole('status').filter({ hasText: 'Calling mode. Page 1 of 3' }),
      ).toHaveCount(1)
      await expect(page.getByRole('group', { name: 'Markup tools' })).toHaveCount(0)

      // The shell behind it is out of reach: Tab never lands on the rail or the top bar.
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab')
        const outside = await page.evaluate(() => {
          const el = document.activeElement
          return el !== null && el !== document.body && el.closest('.calling-view') === null
        })
        expect(outside).toBe(false)
        const inShell = await page.evaluate(
          () =>
            document.activeElement?.closest('nav[aria-label="Binder"], header, [inert]') !== null,
        )
        expect(inShell).toBe(false)
      }
      await expect(page.locator('[inert]').first()).toBeAttached()
      await page.locator('.calling-view .page-list').focus()
      await expect(page.getByRole('button', { name: 'Cue tool' })).toHaveCount(0)
      await expect(page.getByRole('toolbar', { name: 'Viewer' })).toHaveCount(0)
      await expect(page.getByRole('navigation', { name: 'Thumbnails' })).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Cue editor' })).toHaveCount(0)
      await expect(page.locator('[data-page-index="0"]')).toBeVisible()
      await expect(page.getByRole('region', { name: 'Calling status' })).toContainText('Calling')
      await expect(strip).toContainText('p.1 / 3')
      await expect(strip).toContainText(/Next from page top LX\s*4322\s*Calling probe/)

      // The keys that edit do nothing: c over the page, Delete on the tag, a digit.
      const surface = page.locator('[data-page-index="0"] .markup-surface')
      await surface.hover({ position: { x: 200, y: 200 } })
      await page.keyboard.press('c')
      await page.keyboard.press('1')
      await marker(page, id).focus()
      await page.keyboard.press('Delete')
      await page.waitForTimeout(400)
      expect(await versionCueIds(page)).toEqual(before)

      // → turns the page; the strip and the address follow.
      await page.keyboard.press('ArrowRight')
      await expect(strip).toContainText('p.2 / 3')
      await expect(page.locator('[data-page-index="1"]')).toBeInViewport()
      await expect(page).toHaveURL(/[?&]p=2(&|$)/)

      // g opens the keypad, which builds the number, shows what it will land on, and goes there.
      await page.keyboard.press('g')
      const keypad = page.getByRole('dialog', { name: 'Go to' })
      await expect(keypad).toBeVisible()
      for (const key of ['4', '3', '2', '2'])
        await keypad.getByRole('button', { name: key, exact: true }).click()
      await expect(keypad.getByLabel('Cue number')).toHaveText('4322')
      await expect(keypad).toContainText('LX 4322')
      await expect(keypad).toContainText('Calling probe')
      await keypad.getByRole('button', { name: 'Go', exact: true }).click()
      await expect(keypad).toBeHidden()
      await expect(strip).toContainText('p.1 / 3')
      await expect(marker(page, id)).toHaveAttribute('data-selected', 'true')
      await expect(marker(page, id)).toBeInViewport()

      // Escape closes it and focus is back on Go to…; the jump is a Recent chip next time.
      await page.getByRole('button', { name: 'Go to…' }).click()
      await expect(keypad.getByRole('button', { name: 'LX 4322' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(keypad).toBeHidden()
      await expect(page.getByRole('button', { name: 'Go to…' })).toBeFocused()

      // Exit: back to markup on the page it was left on.
      await page.keyboard.press('ArrowRight')
      await expect(strip).toContainText('p.2 / 3')
      await page.getByRole('button', { name: 'Exit' }).click()
      await expect(page).not.toHaveURL(/mode=calling/)
      await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('2 / 3')
      await expect(page.getByRole('group', { name: 'Markup tools' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Calling mode' })).toBeFocused()

      // ⇧C goes in and out as well.
      await page.keyboard.press('Shift+C')
      await expect(page).toHaveURL(/[?&]mode=calling(&|$)/)
      await expect(strip).toContainText('p.2 / 3')
      await page.keyboard.press('Shift+C')
      await expect(strip).toHaveCount(0)
      await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('2 / 3')
    } finally {
      // Always take the probe off the shared show, so the other specs' cue numbers stay theirs.
      if (id) {
        await page.goto(docUrl)
        await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('/ 3', {
          timeout: 30_000,
        })
        if ((await versionCueIds(page)).includes(id)) {
          await marker(page, id).click()
          await page.keyboard.press('Delete')
          await expect.poll(async () => (await versionCueIds(page)).includes(id)).toBe(false)
        }
        // and wait for the removal to reach the server, so the next spec's users do not sync it back
        await expect
          .poll(
            () =>
              page.evaluate(
                async () =>
                  (
                    await window.__binder?.db.get<{ n: number }>(
                      'SELECT count(*) AS n FROM ps_crud',
                    )
                  )?.n ?? -1,
              ),
            { timeout: 20_000 },
          )
          .toBe(0)
      }
    }
  })
})

test('the "…" menu holds Upload revision, the palette, Go to page and Renumber', async ({
  browser,
}) => {
  await withUsers(browser, ['owner'], async ([a]) => {
    const { page } = a
    const bar = page.locator('header')
    await expect(bar.getByRole('button', { name: 'Calling mode' })).toBeVisible()
    // the bar no longer carries Upload revision
    await expect(page.getByRole('button', { name: 'Upload revision' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Document options' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([
      /Upload revision/,
      /Command palette…\s*(⌘K|Ctrl K)/,
      /Go to page…\s*g/,
      /Renumber from script order/,
    ])

    await menu.getByRole('menuitem', { name: 'Go to page…' }).click()
    await expect(
      page.getByRole('toolbar', { name: 'Viewer' }).getByLabel('Go to page'),
    ).toBeFocused()

    await page.getByRole('button', { name: 'Document options' }).click()
    await page.getByRole('menuitem', { name: 'Command palette…' }).click()
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('option', { name: /Switch to calling mode/ })).toContainText(
      '⇧C',
    )
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()

    await page.getByRole('button', { name: 'Document options' }).click()
    await page.getByRole('menuitem', { name: 'Renumber from script order' }).click()
    await expect(page).toHaveURL(/\/cues/)
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Calling mode opens from the document menu, turns pages by a tap, with 44 px targets and no sideways scroll', async ({
    browser,
  }) => {
    const { sharedShow, libretto } = readRun()
    const context = await browser.newContext({ storageState: storageStateFor('owner') })
    try {
      const page = await context.newPage()
      await page.goto(`/shows/${sharedShow.id}/docs/${libretto.documentId}`)
      await expect(page.locator('[data-page-index="0"] canvas')).toBeVisible({ timeout: 30_000 })
      await page.getByRole('button', { name: 'Document options' }).click()
      await page.getByRole('button', { name: 'Calling mode' }).click()
      const strip = page.getByRole('region', { name: 'Calling', exact: true })
      await expect(strip).toBeVisible()
      await expect(page).toHaveURL(/[?&]mode=calling(&|$)/)
      await expect(page.getByRole('region', { name: 'Calling status' })).toContainText('Calling')

      // every control in the strip is at least 44 px, and the page does not scroll sideways
      for (const control of await strip.getByRole('button').all()) {
        const box = await control.boundingBox()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5)
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5)
      }
      const sideways = await page.evaluate(
        () => document.scrollingElement && document.scrollingElement.scrollWidth > innerWidth,
      )
      expect(sideways).toBe(false)

      // a tap on the right third turns forward, on the left third back
      await expect(strip).toContainText('p.1 / 3')
      await page.mouse.click(320, 420)
      await expect(strip).toContainText('p.2 / 3')
      await page.mouse.click(60, 420)
      await expect(strip).toContainText('p.1 / 3')

      await page.getByRole('button', { name: 'Exit' }).click()
      await expect(page).not.toHaveURL(/mode=calling/)
      await expect(page.getByRole('button', { name: 'Document options' })).toBeFocused()
    } finally {
      await context.close()
    }
  })
})
