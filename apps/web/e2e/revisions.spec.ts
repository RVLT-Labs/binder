import { FIXTURES } from '@binder/fixtures'
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { readRun, storageStateFor, type UserKey } from './env'
import {
  anchorOnLine,
  archiveShow,
  createRevisionShow,
  cueEntry,
  currentVersion,
  newRowId,
  noteEntry,
  type RevisionShow,
  signInAsOwner,
  syncUpload,
} from './revisionsHelpers'

/**
 * Revisions on screen: uploading a revised script re-anchors every cue and note, the header counts
 * what is left to review, the review accepts it, the version switcher shows an older version
 * read-only, and compare shows the cut lines. The spec works on a show of its own (made here, with
 * the short libretto and a short revision that cuts lines from page 2), archived when it is done.
 */
test.use({ viewport: { width: 1440, height: 1000 } })
test.describe.configure({ mode: 'serial' })

const READY = { timeout: 150_000 }
let show: RevisionShow
let v2 = ''
const ids = {
  opening: newRowId(),
  twenty: newRowId(),
  revelry: newRowId(),
  song: newRowId(),
  sndRevelry: newRowId(),
  note: newRowId(),
}

test.beforeAll(async () => {
  test.setTimeout(240_000)
  show = await createRevisionShow('Revisions')
  const owner = await signInAsOwner()
  const { users } = readRun()
  const at = (snippet: string) => anchorOnLine(owner, show, show.versionId, snippet)
  // Two LX cues and an SND cue on lines the revision cuts, one LX cue before and one after the cut,
  // and a note on the owner's personal layer on a cut line.
  await syncUpload(owner, [
    cueEntry(show, {
      id: ids.opening,
      departmentId: show.lxId,
      major: 10,
      label: 'Opening',
      anchor: await at('Strong his arm'),
    }),
    cueEntry(show, {
      id: ids.twenty,
      departmentId: show.lxId,
      major: 20,
      label: 'Twenty',
      anchor: await at('Two and twenty'),
    }),
    cueEntry(show, {
      id: ids.revelry,
      departmentId: show.lxId,
      major: 30,
      label: 'Revelry',
      anchor: await at('With unusual revelry'),
    }),
    cueEntry(show, {
      id: ids.song,
      departmentId: show.lxId,
      major: 40,
      label: 'Song',
      anchor: await at('I took and bound this promising'),
    }),
    cueEntry(show, {
      id: ids.sndRevelry,
      departmentId: show.sndId,
      major: 10,
      label: 'Sting',
      anchor: await at('With unusual revelry'),
    }),
    noteEntry(show, {
      id: ids.note,
      userId: users.owner.id,
      text: 'private reminder',
      anchor: await at("And alone he's fit to fly"),
    }),
  ])
})

test.afterAll(async () => {
  await archiveShow(show)
})

const docPath = () => `/shows/${show.showId}/docs/${show.documentId}`

async function open(
  browser: Browser,
  user: UserKey,
  contexts: BrowserContext[],
  path = docPath(),
): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(user) })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto(path)
  await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('/ 3', {
    timeout: 30_000,
  })
  await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })
  return page
}

const toReview = (page: Page, n: number) =>
  expect(page.getByRole('button', { name: `${n} to review`, exact: true })).toBeVisible({
    timeout: 30_000,
  })

const reviewPanel = (page: Page) => page.getByRole('region', { name: 'Revision review' })
const item = (page: Page, text: string) =>
  reviewPanel(page).locator('li[data-review-item]').filter({ hasText: text })

async function openReview(page: Page) {
  const button = page.getByRole('button', { name: /to review$/ })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(reviewPanel(page)).toBeVisible()
}

test('uploading a revision re-anchors, the header counts items to review, accepting one lowers the count for both users', async ({
  browser,
}) => {
  test.setTimeout(300_000)
  const contexts: BrowserContext[] = []
  try {
    const owner = await open(browser, 'owner', contexts)
    const lx = await open(browser, 'lxEditor', contexts)
    // Nothing is moved yet, so there is nothing to review and no revision to compare.
    await expect(owner.getByRole('button', { name: /to review$/ })).toHaveCount(0)

    await owner.getByRole('button', { name: 'Upload revision' }).click()
    const dialog = owner.getByRole('dialog', { name: 'Upload revision' })
    await dialog.getByLabel('PDF file').setInputFiles(FIXTURES.revisedShortCutPdf)
    await dialog.getByLabel('Version label').fill('V2 cuts')
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText(/Processing|Re-anchoring/, {
      timeout: 30_000,
    })

    // The review opens by itself once the document's current version has become the new one.
    await expect(reviewPanel(owner)).toBeVisible(READY)
    await expect(dialog).toBeHidden()
    // The owner sees the cut LX cues, the SND cue and the private note; the LX editor all but the note.
    await toReview(owner, 4)
    await toReview(lx, 3)
    v2 = await currentVersion(await signInAsOwner(), show)
    expect(v2).not.toBe(show.versionId)

    // Grouped by layer: the old and new positions side by side, drawn where the text was.
    const twenty = item(owner, 'LX 20')
    await expect(twenty).toBeVisible()
    await expect(twenty.locator('figure')).toHaveCount(2)
    await expect(twenty.locator('[data-testid="review-thumb-box"]')).toHaveCount(1, {
      timeout: 20_000,
    })
    await expect(twenty.locator('[data-testid="review-thumb-marker"]')).toHaveCount(1)
    await expect(reviewPanel(owner).getByRole('region', { name: 'LX layer' })).toBeVisible()
    await expect(reviewPanel(owner).getByRole('region', { name: 'SND layer' })).toBeVisible()
    await expect(reviewPanel(owner).getByRole('region', { name: 'Personal layer' })).toBeVisible()

    // Accepting one lowers the count for both users, live.
    await twenty.getByRole('button', { name: 'Accept' }).click()
    await expect(item(owner, 'LX 20')).toHaveCount(0)
    await toReview(owner, 3)
    await toReview(lx, 2)

    // The LX editor accepts another from their own panel; the owner's count follows.
    await openReview(lx)
    await item(lx, 'LX 30').getByRole('button', { name: 'Accept' }).click()
    await toReview(lx, 1)
    await toReview(owner, 2)
  } finally {
    for (const c of contexts) await c.close()
  }
})

test('an editor outside a layer and a viewer see the item but cannot accept it, and say why', async ({
  browser,
}) => {
  const contexts: BrowserContext[] = []
  try {
    const lx = await open(browser, 'lxEditor', contexts)
    await openReview(lx)
    // The SND cue is on a layer the LX editor may not edit; the owner's private note is not theirs to see.
    const snd = item(lx, 'SND 10')
    await expect(snd).toBeVisible({ timeout: 20_000 })
    await expect(snd.getByRole('button', { name: 'Accept' })).toBeDisabled()
    await expect(snd.getByRole('button', { name: 'Move' })).toBeDisabled()
    await expect(snd).toContainText("You can't edit SND cues.")
    await expect(lx.getByText('private reminder')).toHaveCount(0)
    await expect(reviewPanel(lx).getByRole('region', { name: 'Personal layer' })).toHaveCount(0)

    const viewer = await open(browser, 'viewer', contexts)
    await openReview(viewer)
    const viewerSnd = item(viewer, 'SND 10')
    await expect(viewerSnd).toBeVisible({ timeout: 20_000 })
    await expect(viewerSnd.getByRole('button', { name: 'Accept' })).toBeDisabled()
    await expect(viewerSnd.getByRole('button', { name: 'Revert to old version' })).toBeDisabled()
    await expect(viewerSnd).toContainText(/can't edit/)
  } finally {
    for (const c of contexts) await c.close()
  }
})

test('the version switcher shows v1 read-only with its cues where they were', async ({
  browser,
}) => {
  const contexts: BrowserContext[] = []
  try {
    const page = await open(browser, 'owner', contexts)
    await expect(page.getByLabel('Version')).toContainText('v2 · ready')
    await page.getByLabel('Version').selectOption(show.versionId)
    await expect(
      page.getByRole('status').filter({ hasText: 'Viewing v1 — read-only' }),
    ).toBeVisible()
    await expect(page.getByLabel('Version')).toHaveValue(show.versionId)

    // The cues are where they were on v1: on the pages the seeded anchors name.
    const marker = (id: string) => page.locator(`[data-cue-id="${id}"]`)
    const owner = await signInAsOwner()
    const where = [
      [ids.opening, 'Strong his arm'],
      [ids.twenty, 'Two and twenty'],
      [ids.revelry, 'With unusual revelry'],
      [ids.song, 'I took and bound this promising'],
    ] as const
    for (const [id, snippet] of where) {
      const { pageIndex } = await anchorOnLine(owner, show, show.versionId, snippet)
      const goTo = page.getByLabel('Go to page')
      await goTo.fill(String(pageIndex + 1))
      await goTo.press('Enter')
      await expect(
        page.locator(`[data-page-index="${pageIndex}"] [data-cue-id="${id}"]`),
      ).toHaveCount(1, { timeout: 30_000 })
    }
    const twentyPage = (await anchorOnLine(owner, show, show.versionId, 'Two and twenty')).pageIndex
    await page.getByLabel('Go to page').fill(String(twentyPage + 1))
    await page.getByLabel('Go to page').press('Enter')
    await expect(marker(ids.twenty)).toBeVisible()

    // Read-only is enforced: no tool, no editor field, no shortcut writes.
    await expect(page.getByRole('button', { name: 'Cue tool' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Rect tool' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled()
    await expect(page.locator('.tool-hint').first()).toHaveText('Viewing v1 — read-only')
    await marker(ids.twenty).locator('rect.cue-marker-box').click()
    const editor = page.getByRole('region', { name: 'Cue editor' })
    await expect(editor).toContainText('Viewing v1 — read-only')
    await expect(editor.getByLabel('Label')).toBeDisabled()
    await page.keyboard.press('Delete')
    await page.keyboard.press('c')
    await expect(marker(ids.twenty)).toHaveCount(1)
    const cueCount = await page.evaluate(
      async (showId) =>
        (
          await window.__binder?.db.getAll<{ n: number }>(
            'SELECT COUNT(*) AS n FROM cues WHERE show_id = ?',
            [showId],
          )
        )?.[0]?.n,
      show.showId,
    )
    expect(cueCount).toBe(5)

    // Back on the current version the tools work again.
    await page.getByRole('button', { name: 'Back to current' }).click()
    await expect(page.getByLabel('Version')).toHaveValue(v2)
    await expect(page.getByRole('button', { name: 'Rect tool' })).toBeEnabled()
    await expect(page.getByText('Viewing v1 — read-only')).toHaveCount(0)
  } finally {
    for (const c of contexts) await c.close()
  }
})

test('compare shows the cut lines as removed', async ({ browser }) => {
  const contexts: BrowserContext[] = []
  try {
    const page = await open(browser, 'owner', contexts)
    await page.getByRole('link', { name: 'Compare' }).click()
    await expect(page.getByRole('heading', { name: 'Compare versions' })).toBeVisible()
    const changes = page.getByRole('navigation', { name: 'Changes' })
    await expect(changes.getByRole('status')).toContainText(/\d+ removed, \d+ added/, {
      timeout: 60_000,
    })
    const removed = changes.locator('button[data-op="removed"]')
    await expect.poll(() => removed.count()).toBeGreaterThanOrEqual(10)
    // The cut lines are listed as removed and none of them as added.
    await expect(removed.filter({ hasText: 'Two and twenty' })).toHaveCount(1)
    await expect(
      changes.locator('button[data-op="added"]').filter({ hasText: 'Two and twenty' }),
    ).toHaveCount(0)

    // Choosing a change takes both sides to it: the old page has the removed line tinted.
    await removed.filter({ hasText: 'Two and twenty' }).click()
    const oldPane = page.getByRole('region', { name: /^Old · v1/ })
    const newPane = page.getByRole('region', { name: /^New · v2/ })
    await expect(oldPane.locator('.compare-tint[data-op="removed"]').first()).toBeVisible({
      timeout: 30_000,
    })
    await expect(newPane.locator('.compare-tint[data-op="removed"]')).toHaveCount(0)
  } finally {
    for (const c of contexts) await c.close()
  }
})
