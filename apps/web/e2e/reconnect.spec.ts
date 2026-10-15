import { execFileSync } from 'node:child_process'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { storageStateFor, type UserKey } from './env'
import { archiveShow, createOwnedShow } from './revisionsHelpers'

/**
 * Playwright's offline switch does not reach PowerSync's shared sync worker, so it cannot show the
 * stream dropping. Stopping the PowerSync service does: the clients lose the stream, an edit made
 * meanwhile stays queued, and everything must converge once the service is back.
 *
 * The spec renames a show of its own, so a failure part-way cannot leave the shared show renamed for
 * the specs that follow; and however it ends, the PowerSync service is started again and awaited.
 */
const POWERSYNC = 'binder-dev-powersync-1'

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim()

async function waitHealthy(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = docker(
      'inspect',
      '-f',
      '{{if .State.Health}}{{.State.Health.Status}}{{end}}',
      POWERSYNC,
    )
    if (status === 'healthy') return
    if (Date.now() > deadline) throw new Error(`${POWERSYNC} is ${status || 'not running'}`)
    await new Promise((r) => setTimeout(r, 1_000))
  }
}

const showLink = (page: Page, title: string) => page.getByRole('link', { name: title, exact: true })

let show: { showId: string; title: string } | undefined

test.beforeAll(async () => {
  show = await createOwnedShow('Reconnect', ['sndEditor'])
})

test.afterAll(async () => {
  try {
    // Whatever happened, leave the dev stack running and healthy for the specs that follow.
    docker('start', POWERSYNC)
    await waitHealthy(90_000)
  } finally {
    await archiveShow(show)
  }
})

test('an edit made while the sync service is down uploads and reaches another user after it returns', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  if (!show) throw new Error('no show')
  const original = show.title
  const renamed = `${original} renamed`
  const contexts: BrowserContext[] = []
  async function open(user: UserKey) {
    const context = await browser.newContext({ storageState: storageStateFor(user) })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto('/')
    return page
  }
  const a = await open('owner')
  const b = await open('sndEditor')
  const status = a.getByLabel('Sync status')
  const uploadEndpoint = '**/api/sync/upload'

  try {
    await expect(showLink(a, original)).toBeVisible({ timeout: 20_000 })
    await expect(showLink(b, original)).toBeVisible({ timeout: 20_000 })
    await expect(status).toHaveText('Connected', { timeout: 20_000 })

    // Uploads go to the API, which stays up when only the sync service stops, so a local edit would
    // upload within moments and the "pending" label would flash by. Hold the upload back, so the
    // edit really does wait in the queue for as long as the service is down.
    await a.context().route(uploadEndpoint, (route) => route.abort('connectionfailed'))
    docker('stop', POWERSYNC)
    // The client notices the stream is gone.
    await expect(status).toContainText('Offline', { timeout: 30_000 })

    // The edit applies locally and waits in the upload queue.
    await a.getByRole('button', { name: `Rename ${original}`, exact: true }).click()
    await a.getByLabel('Show title', { exact: true }).fill(renamed)
    await a.getByRole('button', { name: 'Save' }).click()
    await expect(showLink(a, renamed)).toBeVisible()
    await expect(status).toHaveText('Offline · 1 pending')
    // Long enough for an upload that is not held back to have gone through (it took under 1s).
    await a.waitForTimeout(3_000)
    await expect(status).toHaveText('Offline · 1 pending')

    await a.context().unroute(uploadEndpoint)
    docker('start', POWERSYNC)
    await waitHealthy(90_000)

    // Both clients reconnect by themselves; A's queued edit uploads and B receives it.
    await expect(showLink(b, renamed)).toBeVisible({ timeout: 30_000 })
    await expect(status).toHaveText('Connected', { timeout: 30_000 })
  } finally {
    for (const context of contexts) await context.close()
  }
})
