import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib'
import { readRun, storageStateFor } from './env'
import { clickAt, lineOf, pageText, withUsers, zoomOutTo } from './markupHelpers'

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

/** The show's settings text in this page's local database; throws until the show row is there. */
async function localSettings(page: Page, showId: string): Promise<string | null> {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      return await page.evaluate(async (id) => {
        const db = window.__binder?.db
        if (!db) throw new Error('the local database is not available on this page')
        const row = await db.getOptional<{ settings: string | null }>(
          'SELECT settings FROM shows WHERE id = ?',
          [id],
        )
        if (!row) throw new Error(`show ${id} is not in this page's local database yet`)
        return row.settings
      }, showId)
    } catch (err) {
      if (Date.now() > deadline) throw err
      await page.waitForTimeout(250)
    }
  }
}

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

/** Saves a screenshot into this test's output folder and attaches it to the report. */
async function shot(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: false })
  await test.info().attach(name, { path, contentType: 'image/png' })
}

test('an owner makes SND large: settings, reload, offline replay, page, hit area and export follow; LX stays normal and a member reads it', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const { sharedShow, libretto } = readRun()
  const settingsUrl = `/shows/${sharedShow.id}/settings`
  const docUrl = `/shows/${sharedShow.id}/docs/${libretto.documentId}`
  const work = mkdtempSync(join(tmpdir(), 'binder-cue-size-e2e-'))
  const cueIds: string[] = []
  const sizeGroup = (page: Page, code: string) =>
    page.getByRole('radiogroup', { name: `${code} cue size` })
  const departmentRow = (page: Page, code: string) =>
    page.getByRole('list', { name: 'Departments' }).getByRole('listitem').filter({ hasText: code })
  const pill = (page: Page, id: string) => page.locator(`[data-cue-id="${id}"] rect.cue-tag-body`)
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
    return id
  }

  const member = await (
    await browser.newContext({ storageState: storageStateFor('sndEditor') })
  ).newPage()
  const phone = await (
    await browser.newContext({
      storageState: storageStateFor('owner'),
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    })
  ).newPage()
  try {
    await withUsers(browser, ['owner'], async ([a]) => {
      const { page } = a
      const original = await localSettings(page, sharedShow.id)
      try {
        // Everything starts Normal: nothing changes for a show that never chose a size.
        await page.goto(settingsUrl)
        await expect(sizeGroup(page, 'SND')).toBeVisible({ timeout: 20_000 })
        await expect(sizeGroup(page, 'LX').getByRole('radio', { name: 'Normal' })).toHaveAttribute(
          'aria-checked',
          'true',
        )

        // On a phone the owner taps Large for SND (a 44 px target) and puts SND on the right.
        await phone.goto(settingsUrl)
        const phoneLarge = sizeGroup(phone, 'SND').getByRole('radio', { name: 'Large' })
        await expect(phoneLarge).toBeVisible({ timeout: 20_000 })
        const box = await phoneLarge.boundingBox()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
        await phoneLarge.tap()
        await expect(phoneLarge).toHaveAttribute('aria-checked', 'true')
        await phone
          .getByRole('radiogroup', { name: 'SND marker side' })
          .getByRole('radio', { name: 'Right' })
          .tap()
        await uploaded(phone)
        expect(
          await phone.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(390)
        await departmentRow(phone, 'SND').scrollIntoViewIfNeeded()
        await shot(phone, 'phone-settings-snd-large')

        // The desktop owner sees it after a reload; other settings survive.
        await page.reload()
        await expect(sizeGroup(page, 'SND').getByRole('radio', { name: 'Large' })).toHaveAttribute(
          'aria-checked',
          'true',
          { timeout: 20_000 },
        )
        await expect(sizeGroup(page, 'LX').getByRole('radio', { name: 'Normal' })).toHaveAttribute(
          'aria-checked',
          'true',
        )
        expect(JSON.parse((await localSettings(page, sharedShow.id)) ?? '{}')).toMatchObject({
          cueSizes: { [readRun().departments.SND as string]: 'large' },
          markerSides: { [readRun().departments.SND as string]: 'right' },
        })
        await departmentRow(page, 'SND').scrollIntoViewIfNeeded()
        await shot(page, 'desktop-settings-snd-large')

        // A member reads the word, with no control.
        await member.goto(settingsUrl)
        await expect(departmentRow(member, 'SND')).toContainText('Large', { timeout: 20_000 })
        await expect(departmentRow(member, 'LX')).toContainText('Normal')
        await expect(member.getByRole('radiogroup', { name: /cue size/ })).toHaveCount(0)

        // The script page draws SND's bubble 18.2 pt high on the right, LX's 14 pt on the left.
        await page.goto(docUrl)
        await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('/ 3', {
          timeout: 30_000,
        })
        await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible()
        await zoomOutTo(page)
        // Two SND cues on neighbouring lines so the large tags crowd, one with a long number.
        const snd = await place(page, 'SND', 2)
        const snd2 = await place(page, 'SND', 3)
        const lx = await place(page, 'LX', 6)
        await page.evaluate(async (id) => {
          await window.__binder?.db.execute(
            'UPDATE cues SET major = 1234, minor = 56 WHERE id = ?',
            [id],
          )
        }, snd2)
        await expect(page.locator(`[data-cue-id="${snd2}"]`)).toHaveAttribute(
          'data-cue-label',
          'SND 1234.56',
        )
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await page.keyboard.press('Escape')
        /** Set once SND's first bubble is dragged off the margin: it then leaves the stack. */
        let sndMoved = false
        const check = async () => {
          await expect(pill(page, snd)).toHaveAttribute('height', '18.2')
          await expect(pill(page, snd)).toHaveAttribute('rx', '9.1')
          await expect(pill(page, lx)).toHaveAttribute('height', '14')
          const n = async (id: string, k: string) => Number(await pill(page, id).getAttribute(k))
          // The two large SND pills stack apart in the margin; the long one still fits its margin.
          if (!sndMoved) {
            const a1 = await n(snd, 'y')
            const a2 = await n(snd2, 'y')
            expect(Math.abs(a1 - a2)).toBeGreaterThanOrEqual(18.2 + 2 - 1e-6)
          }
          expect(await n(snd2, 'x')).toBeGreaterThan(0)
          await expect(page.locator(`[data-cue-id="${snd2}"] .cue-tag-number`)).toHaveText(
            '1234.56',
          )
          // LX is untouched: flush with the left page edge.
          expect(await n(lx, 'x')).toBe(4)
        }
        await check()
        await shot(page, 'desktop-page-snd-large-right-lx-normal-left')

        // The larger pill is the hit area: a click 8 pt above its centre (outside a normal pill) selects it.
        const body = await pill(page, snd).boundingBox()
        if (!body) throw new Error('no SND pill on screen')
        await page.mouse.click(body.x + body.width / 2, body.y + body.height * 0.08)
        await expect(page.locator(`[data-cue-id="${snd}"]`)).toHaveAttribute(
          'data-selected',
          'true',
        )
        // Selected, the large bubble drags: pick it up by its centre, drop it 60 px left and down.
        const from = { x: body.x + body.width / 2, y: body.y + body.height / 2 }
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(from.x - 30, from.y + 30, { steps: 5 })
        await expect(page.locator('.cue-bubble-preview rect.cue-tag-body')).toHaveAttribute(
          'height',
          '18.2',
        )
        await page.mouse.move(from.x - 60, from.y + 60, { steps: 5 })
        await page.mouse.up()
        await expect
          .poll(() =>
            page.evaluate(
              async (id) =>
                (
                  await window.__binder?.db.get<{ tag: string | null }>(
                    `SELECT json_extract(anchor, '$.tag') AS tag FROM cues WHERE id = ?`,
                    [id],
                  )
                )?.tag ?? null,
              snd,
            ),
          )
          .not.toBeNull()
        sndMoved = true
        await expect(pill(page, snd)).toHaveAttribute('height', '18.2')
        await shot(page, 'desktop-page-large-bubble-dragged')
        await page.keyboard.press('Escape')

        // Zoomed in, the drawing scales with the page and keeps its proportions.
        await page.getByRole('button', { name: 'Zoom in' }).click()
        await check()
        await shot(page, 'desktop-page-zoomed-in')

        await uploaded(page)
        await page.reload()
        await expect(page.locator(`[data-cue-id="${snd}"]`)).toBeVisible({ timeout: 30_000 })
        await check()

        // The exported PDF prints SND's code and number at 11.7 pt and LX's at 9 pt.
        await page.getByRole('button', { name: 'Print', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Print' })
        await dialog.getByRole('button', { name: 'Calling script: all layers' }).click()
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          dialog.getByRole('button', { name: 'Download PDF' }).click(),
        ])
        await expect(dialog).toBeHidden()
        const saved = test.info().outputPath('calling-script-snd-large.pdf')
        await download.saveAs(saved)
        await test.info().attach('calling-script-snd-large.pdf', {
          path: saved,
          contentType: 'application/pdf',
        })
        const content = await firstPageContent(readFileSync(saved))
        // The bold face's sizes as numbers: pdf-lib prints 11.7 as 11.700000000000001.
        const boldSizes = [...content.matchAll(/\/Helvetica-Bold[-\d]* ([\d.]+) Tf/g)].map((m) =>
          Number(m[1]),
        )
        expect(boldSizes.some((s) => Math.abs(s - 11.7) < 1e-6)).toBe(true)
        expect(boldSizes.some((s) => s === 9)).toBe(true)
        expect(boldSizes.every((s) => s === 9 || Math.abs(s - 11.7) < 1e-6)).toBe(true)

        // The stored cues as they are before the size changes: a size is a show setting and
        // never touches a cue's number, label, notes, anchor, bubble offset, type or department.
        const cueRows = (p: Page) =>
          p.evaluate(
            async (ids) =>
              (await window.__binder?.db.getAll(
                `SELECT id, department_id, major, minor, label, type, notes, colour, anchor
                   FROM cues WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
                ids,
              )) ?? [],
            cueIds,
          )
        await uploaded(page)
        const before = await cueRows(page)
        expect(before).toHaveLength(3)

        // Offline: the owner turns SND back to Normal. The script page open in another tab of
        // the same browser redraws at once from the local database; the write goes up when the
        // connection comes back, and survives a reload.
        const script = await page.context().newPage()
        await script.goto(docUrl)
        await expect(pill(script, snd)).toHaveAttribute('height', '18.2', { timeout: 30_000 })
        await page.goto(settingsUrl)
        await expect(sizeGroup(page, 'SND')).toBeVisible({ timeout: 20_000 })
        await page.context().setOffline(true)
        await sizeGroup(page, 'SND').getByRole('radio', { name: 'Normal' }).click()
        await expect(sizeGroup(page, 'SND').getByRole('radio', { name: 'Normal' })).toHaveAttribute(
          'aria-checked',
          'true',
        )
        await expect(pill(script, snd)).toHaveAttribute('height', '14', { timeout: 20_000 })
        await expect(pill(script, snd2)).toHaveAttribute('height', '14')
        await shot(script, 'desktop-page-offline-back-to-normal')
        expect(
          await page.evaluate(
            async () =>
              (await window.__binder?.db.get<{ n: number }>('SELECT count(*) AS n FROM ps_crud'))
                ?.n ?? 0,
          ),
        ).toBeGreaterThan(0)
        await page.context().setOffline(false)
        await uploaded(page)
        await script.reload()
        await expect(pill(script, snd)).toHaveAttribute('height', '14', { timeout: 30_000 })
        await script.close()
        await member.reload()
        await expect(departmentRow(member, 'SND')).toContainText('Normal', { timeout: 30_000 })
        expect(await cueRows(page)).toEqual(before)
      } finally {
        await page.context().setOffline(false)
        if (cueIds.length) {
          await page.goto(docUrl)
          await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({
            timeout: 30_000,
          })
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
    await phone.context().close()
    rmSync(work, { recursive: true, force: true })
  }
})
