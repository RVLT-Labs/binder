import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { FIXTURES } from '@binder/fixtures'
import {
  type Browser,
  type BrowserContext,
  type Download,
  expect,
  type Page,
  test,
} from '@playwright/test'
import { API_URL, APP_URL, readRun, storageStateFor, type UserKey } from './env'
import { railLink, showCrumb } from './helpers'

/**
 * Print, the export outbox, and the exports screen. The specs share one fresh show of their own (made
 * in beforeAll, with its own copy of the short libretto), so its exports list holds only what these
 * tests make, whatever the other specs left in the run's shared show.
 */
test.use({ viewport: { width: 1440, height: 1000 } })
test.describe.configure({ mode: 'serial' })

interface Fixture {
  showId: string
  title: string
  documentId: string
}
let show: Fixture
let work: string

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** The text of each page of a PDF, as poppler reads it. */
function pagesText(path: string): string[] {
  const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' })
  // Poppler ends every page with a form feed.
  return text.split('\f').slice(0, -1)
}

async function call<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`sign-in: ${res.status} ${await res.text()}`)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function createFixture(): Promise<Fixture> {
  const { users, password } = readRun()
  const owner = await signIn(users.owner.email, password)
  const { organisations } = await call<{ organisations: { id: string }[] }>(
    owner,
    'GET',
    '/api/me/orgs',
  )
  const title = `Exports ${Date.now()}`
  const { show: created } = await call<{ show: { id: string } }>(
    owner,
    'POST',
    `/api/orgs/${organisations[0]?.id}/shows`,
    { title },
  )
  await call(owner, 'POST', `/api/shows/${created.id}/members`, {
    email: users.viewer.email,
    role: 'viewer',
  })

  const form = new FormData()
  form.append('kind', 'libretto')
  form.append('title', 'Export libretto')
  form.append(
    'file',
    new Blob([readFileSync(FIXTURES.librettoShortPdf)], { type: 'application/pdf' }),
    basename(FIXTURES.librettoShortPdf),
  )
  const res = await fetch(`${API_URL}/api/shows/${created.id}/documents`, {
    method: 'POST',
    headers: { cookie: owner, origin: APP_URL },
    body: form,
  })
  if (!res.ok) throw new Error(`upload: ${res.status} ${await res.text()}`)
  const { document, version } = (await res.json()) as {
    document: { id: string }
    version: { id: string }
  }
  const deadline = Date.now() + 150_000
  for (;;) {
    const { documents } = await call<{
      documents: { id: string; versions: { id: string; status: string }[] }[]
    }>(owner, 'GET', `/api/shows/${created.id}/documents`)
    const status = documents
      .find((d) => d.id === document.id)
      ?.versions.find((v) => v.id === version.id)?.status
    if (status === 'ready') break
    if (status === 'failed' || Date.now() > deadline) throw new Error(`libretto ${status}`)
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return { showId: created.id, title, documentId: document.id }
}

test.beforeAll(async () => {
  test.setTimeout(200_000)
  work = mkdtempSync(join(tmpdir(), 'binder-export-e2e-'))
  show = await createFixture()
})

/** Archives the spec's show, so the owner's list of active shows is what other specs expect. */
test.afterAll(async () => {
  rmSync(work, { recursive: true, force: true })
  if (!show) return
  const { users, password } = readRun()
  const owner = await signIn(users.owner.email, password)
  await call(owner, 'PATCH', `/api/shows/${show.showId}`, { status: 'archived' })
})

async function open(
  browser: Browser,
  user: UserKey,
  contexts: BrowserContext[],
  path: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: storageStateFor(user) })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto(path)
  return { context, page }
}

const docPath = () => `/shows/${show.showId}/docs/${show.documentId}`

/** Waits for the viewer, its layers, and the first page's markup surface. */
async function viewerReady(page: Page): Promise<void> {
  await expect(page.getByRole('toolbar', { name: 'Viewer' })).toContainText('1 / 3', {
    timeout: 30_000,
  })
  await expect(page.getByRole('region', { name: 'Layers' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-page-index="0"] .markup-surface')).toBeVisible()
}

/** Puts an LX cue in the middle of page 1 with the cue tool; the first cue of a fresh show is LX 10. */
async function placeLxCue(page: Page): Promise<void> {
  await page.getByLabel('Active layer LX').check()
  await page.getByRole('button', { name: 'Cue tool' }).click()
  const box = await page.locator('[data-page-index="0"]').boundingBox()
  if (!box) throw new Error('page 1 is not on screen')
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await expect(page.getByRole('button', { name: 'LX 10, page 1', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
}

/** Opens Print, picks a preset or the personal layer, and exports; resolves to the download. */
async function exportFrom(
  page: Page,
  choose: (dialog: ReturnType<Page['getByRole']>) => Promise<void>,
): Promise<Download> {
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Print' })
  await choose(dialog)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export PDF' }).click(),
  ])
  await expect(dialog).toBeHidden()
  return download
}

const callingScript = (dialog: ReturnType<Page['getByRole']>) =>
  dialog.getByRole('button', { name: 'Calling script: all layers' }).click()

const exportRow = (page: Page, filename: string) =>
  page.locator('li[data-export-id]').filter({ hasText: filename })

test('exporting the calling script downloads a PDF with the same page count whose text has the script and "LX 10", and the exports screen lists it', async ({
  browser,
}) => {
  test.skip(!hasPdftotext, 'poppler (pdftotext) is not installed')
  const contexts: BrowserContext[] = []
  try {
    const { page } = await open(browser, 'owner', contexts, docPath())
    await viewerReady(page)
    await placeLxCue(page)

    const download = await exportFrom(page, callingScript)
    const filename = download.suggestedFilename()
    expect(filename).toBe(`${show.title} - Export libretto v1 - All layers.pdf`)
    const saved = join(work, 'calling-script.pdf')
    await download.saveAs(saved)
    const bytes = readFileSync(saved)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')

    // Same pages as the source, each with its own text, and the cue and footer drawn on.
    const source = pagesText(FIXTURES.librettoShortPdf)
    const exported = pagesText(saved)
    expect(exported).toHaveLength(source.length)
    for (const [i, text] of source.entries()) {
      const firstLine =
        text
          .split('\n')
          .find((l) => l.trim().length > 3)
          ?.trim() ?? ''
      expect(firstLine).not.toBe('')
      expect(exported[i]).toContain(firstLine)
    }
    // The cue is a tag in the margin: its code and number, not its label, not over the script.
    expect(exported[0]).toMatch(/LX\s+10/)
    expect(exported.join('\n')).toContain(`${show.title} · Export libretto v1 · All layers`)

    // The exports screen lists the record once it has uploaded and synced back.
    await railLink(page, 'Exports').click()
    const row = exportRow(page, filename)
    await expect(row).toHaveCount(1, { timeout: 30_000 })
    await expect(row).toContainText('All layers')
    await expect(row).not.toContainText('Only you')

    // "Download again" saves the stored file (the server shows it inline, so the link forces a save).
    const link = row.getByRole('link', { name: 'Download again' })
    await expect(link).toHaveAttribute('download', filename)
    const [again] = await Promise.all([page.waitForEvent('download'), link.click()])
    expect(again.suggestedFilename()).toBe(filename)
    expect(readFileSync((await again.path()) ?? '').equals(bytes)).toBe(true)

    // "What changed since this" opens the activity feed from the record's time.
    const request = page.waitForRequest(
      (r) => /\/api\/shows\/[^/]+\/activity\?.*from=/.test(r.url()),
      { timeout: 20_000 },
    )
    await row.getByRole('link', { name: 'What changed since this' }).click()
    await expect(page).toHaveURL(/\/activity\?from=/)
    await request
    await expect(page.getByText(/Changes since/)).toBeVisible()
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('an export made offline downloads at once and its record appears after reconnecting', async ({
  browser,
}) => {
  const contexts: BrowserContext[] = []
  try {
    const { context, page } = await open(
      browser,
      'owner',
      contexts,
      `/shows/${show.showId}/exports`,
    )
    // Warm the screens offline navigation will need, then count the records already listed.
    await expect(page.getByRole('heading', { name: 'Exports' })).toBeVisible({ timeout: 30_000 })
    const records = page.locator('li[data-export-id]')
    await expect(records.first()).toBeVisible({ timeout: 30_000 })
    const before = await records.count()

    await showCrumb(page, show.title).click()
    await page.getByRole('list', { name: 'Documents' }).getByRole('link').first().click()
    await viewerReady(page)

    // The dialog opens online (it loads the stamping code), then the network goes away.
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Print' })
    await callingScript(dialog)
    await expect(dialog.getByText('Footer layers: All layers')).toBeVisible()
    await page.waitForTimeout(1_000)
    await context.setOffline(true)
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Export PDF' }).click(),
    ])
    await expect(dialog).toBeHidden()
    const filename = download.suggestedFilename()
    const saved = join(work, 'offline.pdf')
    await download.saveAs(saved)
    expect(readFileSync(saved).subarray(0, 5).toString()).toBe('%PDF-')

    // Offline the file is on the device and waiting to upload; the list has no record of it yet.
    await railLink(page, 'Exports').click()
    const waiting = page.getByRole('region', { name: 'Waiting to upload' })
    await expect(waiting).toContainText(filename)
    await expect(records).toHaveCount(before)
    // Offline, a stored file this device never downloaded cannot be fetched: said, not a dead link.
    const first = records.first()
    await expect(first.getByRole('button', { name: 'Download again' })).toBeDisabled()
    await expect(first.getByText('Available when online')).toBeVisible()
    await expect(first.getByRole('link', { name: 'Download again' })).toHaveCount(0)

    // Back online the outbox uploads it, the record syncs down, and nothing is waiting.
    await context.setOffline(false)
    await expect(records).toHaveCount(before + 1, { timeout: 60_000 })
    await expect(waiting).toHaveCount(0, { timeout: 30_000 })
    await expect(first.getByRole('link', { name: 'Download again' })).toBeVisible()
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('an export that includes the personal layer says so, is private to its maker, and the shared one reaches the viewer', async ({
  browser,
}) => {
  const contexts: BrowserContext[] = []
  try {
    const { page } = await open(browser, 'owner', contexts, docPath())
    await viewerReady(page)

    const download = await exportFrom(page, async (dialog) => {
      await dialog.getByRole('button', { name: 'Clean copy' }).click()
      await expect(dialog.getByText('Only you will see this export.')).toHaveCount(0)
      await dialog.getByLabel('Personal layer').check()
      await expect(dialog.getByText('Only you will see this export.')).toBeVisible()
      // Another person's personal layer is never offered, and neither is a departments' hidden one.
      await expect(dialog.getByLabel('Personal layer')).toHaveCount(1)
    })
    const privateName = download.suggestedFilename()
    expect(privateName).toBe(`${show.title} - Export libretto v1 - Personal.pdf`)

    await page.goto(`/shows/${show.showId}/exports`)
    const mine = exportRow(page, privateName)
    await expect(mine).toHaveCount(1, { timeout: 30_000 })
    await expect(mine).toContainText('Only you')

    // The viewer gets the shared exports, never the owner's private one.
    const viewer = await open(browser, 'viewer', contexts, `/shows/${show.showId}/exports`)
    await expect(
      exportRow(viewer.page, `${show.title} - Export libretto v1 - All layers.pdf`).first(),
    ).toBeVisible({
      timeout: 30_000,
    })
    await expect(exportRow(viewer.page, privateName)).toHaveCount(0)
  } finally {
    for (const context of contexts) await context.close()
  }
})

test('an export kept waiting is uploaded right after signing in, with no reload', async ({
  browser,
}) => {
  const { users, password } = readRun()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in to Binder' })).toBeVisible()

    // As if kept after a 401: an entry in the owner's outbox while nobody is signed in.
    const id = randomUUID()
    const filename = `Kept after sign-out ${Date.now()}.pdf`
    await page.evaluate(
      async ({ userId, entry }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(`binder-exports-${userId}`, 1)
          open.onupgradeneeded = () => open.result.createObjectStore('pending')
          open.onsuccess = () => resolve(open.result)
          open.onerror = () => reject(open.error)
        })
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('pending', 'readwrite')
          tx.objectStore('pending').put(
            { ...entry, bytes: new TextEncoder().encode('%PDF-1.4\n%%EOF\n') },
            entry.id,
          )
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        db.close()
      },
      {
        userId: users.owner.id,
        entry: {
          id,
          showId: show.showId,
          userId: users.owner.id,
          meta: {
            id,
            kind: 'pdf-script',
            filename,
            layerSelection: [],
            createdAt: new Date().toISOString(),
          },
          contentType: 'application/pdf',
        },
      },
    )

    await page.getByLabel('Email').fill(users.owner.email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Client-side navigation only: a reload would flush at start and hide what this tests.
    await page.getByRole('link', { name: show.title }).click()
    await railLink(page, 'Exports').click()
    await expect(exportRow(page, filename)).toHaveCount(1, { timeout: 30_000 })
  } finally {
    await context.close()
  }
})
