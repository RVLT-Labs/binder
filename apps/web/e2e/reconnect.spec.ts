import { execFileSync } from 'node:child_process'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { storageStateFor, type UserKey } from './env'

/**
 * Playwright's offline switch does not reach PowerSync's shared sync worker, so it cannot show the
 * stream dropping. Stopping the PowerSync service does: the clients lose the stream, an edit made
 * meanwhile stays queued, and everything must converge once the service is back.
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

test('an edit made while the sync service is down uploads and reaches another user after it returns', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const contexts: BrowserContext[] = []
  async function open(user: UserKey) {
    const context = await browser.newContext({ storageState: storageStateFor(user) })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto('/')
    return page
  }
  const a = await open('a')
  const b = await open('b')

  try {
    // A owns exactly one show here: the shared one, whatever its title is by now.
    const link = a.getByRole('list', { name: 'Active shows' }).getByRole('link')
    await expect(link).toBeVisible({ timeout: 20_000 })
    const original = (await link.textContent()) ?? ''
    const renamed = `${original} reconnect`
    await expect(showLink(b, original)).toBeVisible({ timeout: 20_000 })
    await expect(a.getByLabel('Sync status')).toHaveText('Connected')

    docker('stop', POWERSYNC)
    // The client notices the stream is gone.
    await expect(a.getByLabel('Sync status')).toContainText('Offline', { timeout: 30_000 })

    // The edit applies locally and waits in the upload queue.
    await a.getByRole('button', { name: `Rename ${original}`, exact: true }).click()
    await a.getByLabel('Show title', { exact: true }).fill(renamed)
    await a.getByRole('button', { name: 'Save' }).click()
    await expect(showLink(a, renamed)).toBeVisible()
    await expect(a.getByLabel('Sync status')).toHaveText('Offline · 1 pending')

    docker('start', POWERSYNC)
    await waitHealthy(90_000)

    // Both clients reconnect by themselves; A's queued edit uploads and B receives it.
    await expect(showLink(b, renamed)).toBeVisible({ timeout: 30_000 })
    await expect(a.getByLabel('Sync status')).toHaveText('Connected', { timeout: 30_000 })

    // Leave the title as it was for the other specs.
    await a.getByRole('button', { name: `Rename ${renamed}`, exact: true }).click()
    await a.getByLabel('Show title', { exact: true }).fill(original)
    await a.getByRole('button', { name: 'Save' }).click()
    await expect(showLink(b, original)).toBeVisible({ timeout: 30_000 })
  } finally {
    // Whatever happened, leave the dev stack running and healthy.
    docker('start', POWERSYNC)
    await waitHealthy(90_000)
    for (const context of contexts) await context.close()
  }
})
