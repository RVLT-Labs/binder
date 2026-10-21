import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { storageStateFor, type UserKey } from './env'
import { archiveShow, call, createOwnedShow, signInAsOwner } from './revisionsHelpers'

/**
 * Bringing a show back out of the archive, through the screens: the Reactivate button on the shows
 * home and the banner on the archived show's own page. The owner's click is a local write that has
 * to upload and reach the editor, and the server has to accept it (an archived show refuses every
 * other change), so each test ends by asking the server too.
 *
 * The spec uses a show of its own and archives it again when it is done.
 */
test.describe.configure({ mode: 'serial' })

let show: { showId: string; title: string } | undefined

test.beforeAll(async () => {
  show = await createOwnedShow('Reactivate', ['sndEditor'])
})

test.afterAll(async () => {
  await archiveShow(show)
})

const archivedList = (page: Page) => page.getByRole('list', { name: 'Archived shows' })
const activeList = (page: Page) => page.getByRole('list', { name: 'Active shows' })
const showLink = (list: ReturnType<typeof archivedList>, title: string) =>
  list.getByRole('link', { name: title, exact: true })

/** Whether the server lists the show among the owner's active shows. */
async function serverSaysActive(showId: string): Promise<boolean> {
  const { active } = await call<{ active: { id: string }[] }>(
    await signInAsOwner(),
    'GET',
    '/api/me/shows',
  )
  return active.some((s) => s.id === showId)
}

async function open(
  browser: { newContext: (o: { storageState: string }) => Promise<BrowserContext> },
  user: UserKey,
  path: string,
  contexts: BrowserContext[],
) {
  const context = await browser.newContext({ storageState: storageStateFor(user) })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto(path)
  return page
}

test('an owner reactivates an archived show from the shows home; the editor sees it move too', async ({
  browser,
}) => {
  if (!show) throw new Error('no show')
  const { showId, title } = show
  await archiveShow(show)
  const contexts: BrowserContext[] = []
  try {
    const owner = await open(browser, 'owner', '/', contexts)
    const editor = await open(browser, 'sndEditor', '/', contexts)

    // Both see it under Archived; only the owner is offered the way back, and neither can rename it.
    await expect(showLink(archivedList(owner), title)).toBeVisible({ timeout: 20_000 })
    await expect(showLink(archivedList(editor), title)).toBeVisible({ timeout: 20_000 })
    const reactivate = owner.getByRole('button', { name: `Reactivate ${title}`, exact: true })
    await expect(reactivate).toBeVisible()
    await expect(
      editor.getByRole('button', { name: `Reactivate ${title}`, exact: true }),
    ).toHaveCount(0)
    await expect(owner.getByRole('button', { name: `Rename ${title}`, exact: true })).toHaveCount(0)
    expect((await reactivate.boundingBox())?.height).toBeGreaterThanOrEqual(44)

    await reactivate.click()

    // The card moves up to Active under the owner's keyboard focus ...
    await expect(showLink(activeList(owner), title)).toBeVisible({ timeout: 10_000 })
    await expect(showLink(activeList(owner), title)).toBeFocused()
    await expect(showLink(archivedList(owner), title)).toHaveCount(0)
    // ... the server accepted the change ...
    await expect.poll(() => serverSaysActive(showId), { timeout: 20_000 }).toBe(true)
    // ... and it reaches the editor through sync, who can rename it again.
    await expect(showLink(activeList(editor), title)).toBeVisible({ timeout: 20_000 })
    await expect(editor.getByRole('button', { name: `Rename ${title}`, exact: true })).toBeVisible()
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('an archived show opens with a banner: the owner reactivates it there, the editor is told whom to ask', async ({
  browser,
}) => {
  if (!show) throw new Error('no show')
  const { showId, title } = show
  await archiveShow(show)
  const contexts: BrowserContext[] = []
  try {
    const owner = await open(browser, 'owner', `/shows/${showId}`, contexts)
    const editor = await open(browser, 'sndEditor', `/shows/${showId}`, contexts)
    const banner = (page: Page) => page.getByRole('region', { name: 'Archived show' })

    await expect(banner(owner)).toContainText('This show is archived', { timeout: 20_000 })
    await expect(banner(editor)).toContainText('Ask an owner to reactivate it.', {
      timeout: 20_000,
    })
    await expect(editor.getByRole('button', { name: 'Reactivate show' })).toHaveCount(0)

    await owner.getByRole('button', { name: 'Reactivate show' }).click()

    await expect(banner(owner)).toHaveCount(0)
    await expect.poll(() => serverSaysActive(showId), { timeout: 20_000 }).toBe(true)
    await expect(banner(editor)).toHaveCount(0, { timeout: 20_000 })
    // The show is back in the shows home's Active list.
    await owner.goto('/')
    await expect(showLink(activeList(owner), title)).toBeVisible({ timeout: 20_000 })
  } finally {
    for (const context of contexts) await context.close()
  }
})
