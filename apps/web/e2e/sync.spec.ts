import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { readRun, storageStateFor, type UserKey } from './env'

const showLink = (page: Page, title: string) => page.getByRole('link', { name: title, exact: true })

async function rename(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: `Rename ${from}`, exact: true }).click()
  await page.getByLabel('Show title', { exact: true }).fill(to)
  await page.getByRole('button', { name: 'Save' }).click()
}

test('edits sync between two users, survive offline, rejections converge, and non-members never see the show', async ({
  browser,
}) => {
  const { sharedShow, cShow } = readRun()
  const title = sharedShow.title
  const [ii, iii, nope] = [`${title} II`, `${title} III`, `${title} Nope`]

  const contexts: BrowserContext[] = []
  async function open(user: UserKey) {
    const context = await browser.newContext({ storageState: storageStateFor(user) })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto('/')
    return { context, page }
  }
  const a = await open('owner')
  const b = await open('sndEditor')
  const c = await open('outsider')

  try {
    // Initial sync: owner and editor both receive the shared show.
    await expect(showLink(a.page, title)).toBeVisible({ timeout: 20_000 })
    await expect(showLink(b.page, title)).toBeVisible({ timeout: 20_000 })
    await expect(a.page.getByLabel('Sync status')).toHaveText('Connected', { timeout: 20_000 })

    // Live: A renames, B sees it.
    await rename(a.page, title, ii)
    await expect(showLink(b.page, ii)).toBeVisible({ timeout: 5_000 })

    // Offline: A's rename applies locally and waits in the upload queue.
    await a.context.setOffline(true)
    await rename(a.page, ii, iii)
    await expect(showLink(a.page, iii)).toBeVisible()
    await expect(a.page.getByLabel('Sync status')).toHaveText('Offline · 1 pending')
    // Long enough for an upload attempt and retry: B must still see the old title.
    await b.page.waitForTimeout(3_000)
    await expect(showLink(b.page, ii)).toBeVisible()

    // Back online: the queued change uploads and reaches B.
    await a.context.setOffline(false)
    await expect(showLink(b.page, iii)).toBeVisible({ timeout: 10_000 })
    await expect(a.page.getByLabel('Sync status')).toHaveText('Connected', { timeout: 10_000 })

    // Rejection: B is an editor, and renaming a show is owner-only. B is told, and converges back.
    await rename(b.page, iii, nope)
    await expect(b.page.getByRole('alert')).toContainText('was not saved', { timeout: 10_000 })
    await expect(showLink(b.page, iii)).toBeVisible({ timeout: 10_000 })
    await expect(showLink(b.page, nope)).toHaveCount(0)
    await expect(showLink(a.page, iii)).toBeVisible()
    await expect(showLink(a.page, nope)).toHaveCount(0)

    // Isolation: C has synced (C's own show is there) but never receives the shared show.
    await expect(showLink(c.page, cShow.title)).toBeVisible({ timeout: 20_000 })
    for (const t of [title, ii, iii, nope]) await expect(showLink(c.page, t)).toHaveCount(0)
    expect(await c.page.evaluate(() => document.body.innerText)).not.toContain(title)
  } finally {
    for (const context of contexts) await context.close()
  }
})
