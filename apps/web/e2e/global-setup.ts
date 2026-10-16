import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { ensureFixtures, FIXTURES } from '@binder/fixtures'
import { chromium } from '@playwright/test'
import {
  API_URL,
  APP_URL,
  AUTH_DIR,
  apiEnv,
  PREVIEW_URL,
  REPO_ROOT,
  RUN_FILE,
  type RunData,
  type UserKey,
} from './env'

const NAMES: Record<UserKey, string> = {
  owner: 'Alice',
  sndEditor: 'Bob',
  lxEditor: 'Lena',
  viewer: 'Victor',
  outsider: 'Carol',
}
/** How long the libretto may take to process. */
const READY_TIMEOUT_MS = 180_000

/**
 * Creates five fresh users and two shows against the dev database. The owner shares the first show
 * with an editor scoped to SND, an editor scoped to LX, and a viewer, and uploads a short libretto
 * to it; the outsider owns the second. Every name carries a run suffix, so the suite can run again
 * and again against the persistent dev stack.
 */
export default async function globalSetup() {
  await ensureFixtures()
  const run = `${Date.now()}`
  const password = randomBytes(18).toString('base64url')
  const users = {} as RunData['users']
  for (const key of Object.keys(NAMES) as UserKey[]) {
    const email = `${key.toLowerCase()}-${run}@e2e.test`
    const name = `${NAMES[key]} ${run}`
    const out = execFileSync(
      'pnpm',
      [
        '--filter',
        '@binder/api',
        'exec',
        'tsx',
        'src/cli.ts',
        'create-user',
        '--email',
        email,
        '--name',
        name,
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ...apiEnv(), BINDER_PASSWORD: password },
        stdio: 'pipe',
      },
    )
    // The CLI prints the new user's id.
    const id = out.toString().trim().split('\n').at(-1)?.trim() ?? ''
    if (!id) throw new Error(`create-user ${email} printed no id`)
    users[key] = { id, email, name }
  }

  const owner = await signIn(users.owner.email, password)
  const sharedShow = await createShow(owner, `Pirates ${run}`)
  const list = await call<{ departments: { id: string; code: string }[] }>(
    owner,
    'GET',
    `/api/shows/${sharedShow.id}/departments`,
  )
  const departments = Object.fromEntries(list.departments.map((d) => [d.code, d.id]))
  await addMember(owner, sharedShow.id, users.sndEditor.email, 'editor', [departments.SND])
  await addMember(owner, sharedShow.id, users.lxEditor.email, 'editor', [departments.LX])
  await addMember(owner, sharedShow.id, users.viewer.email, 'viewer')
  const libretto = await uploadAndWait(owner, sharedShow.id, FIXTURES.librettoShortPdf)

  const outsider = await signIn(users.outsider.email, password)
  const cShow = await createShow(outsider, `Carol's show ${run}`)

  mkdirSync(AUTH_DIR, { recursive: true })
  const data: RunData = { password, users, sharedShow, departments, cShow, libretto }
  writeFileSync(RUN_FILE, JSON.stringify(data, null, 2))

  await warmUp(owner, data)
}

/**
 * Loads the app once in a real browser before any spec does. A cold dev server compiles every module
 * on first request (and re-optimises its dependencies, which reloads the page), and a first
 * navigation that has to wait for that would fail the first spec's timeout on a fresh machine. The
 * visit signs in as the run's owner and opens the screens that pull in the most code (the show, the
 * script with PDF.js). The preview server, when this run has one, is visited too, for its first
 * response. Best effort: a warm-up that fails only costs the speed-up, so it never fails the run.
 */
async function warmUp(ownerCookie: string, run: RunData) {
  const browser = await chromium.launch()
  try {
    const cookies = ownerCookie.split('; ').map((pair) => {
      const at = pair.indexOf('=')
      return { name: pair.slice(0, at), value: pair.slice(at + 1), url: APP_URL }
    })
    const targets: { origin: string; paths: string[] }[] = [
      {
        origin: APP_URL,
        paths: [
          '/login',
          '/',
          `/shows/${run.sharedShow.id}`,
          `/shows/${run.sharedShow.id}/docs/${run.libretto.documentId}`,
          `/shows/${run.sharedShow.id}/cues`,
        ],
      },
    ]
    if (await responds(PREVIEW_URL)) targets.push({ origin: PREVIEW_URL, paths: ['/login'] })
    for (const { origin, paths } of targets) {
      const context = await browser.newContext()
      await context.addCookies(cookies.map((c) => ({ ...c, url: origin })))
      const page = await context.newPage()
      for (const path of paths) {
        try {
          // Not `networkidle`: the sync stream is a request that never ends, so the app never idles.
          await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 90_000 })
          // Lazily imported modules (routes, PDF.js, the worker) are requested after `load`.
          await page.waitForTimeout(3_000)
        } catch (err) {
          console.warn(`warm-up: ${origin}${path}: ${(err as Error).message.split('\n')[0]}`)
        }
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

/** Whether something answers at the URL within a few seconds. */
async function responds(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3_000) })
    return true
  } catch {
    return false
  }
}

async function addMember(
  cookie: string,
  showId: string,
  email: string,
  role: 'editor' | 'viewer',
  scope?: string[],
) {
  const { membership } = await call<{ membership: { id: string } }>(
    cookie,
    'POST',
    `/api/shows/${showId}/members`,
    { email, role },
  )
  if (scope)
    await call(cookie, 'PATCH', `/api/memberships/${membership.id}`, { departments: scope })
}

/** Uploads a libretto PDF and waits for its first version to finish processing. */
async function uploadAndWait(
  cookie: string,
  showId: string,
  file: string,
): Promise<RunData['libretto']> {
  const form = new FormData()
  form.append('kind', 'libretto')
  form.append('title', 'Markup libretto')
  form.append('file', new Blob([readFileSync(file)], { type: 'application/pdf' }), basename(file))
  const res = await fetch(`${API_URL}/api/shows/${showId}/documents`, {
    method: 'POST',
    headers: { cookie, origin: APP_URL },
    body: form,
  })
  if (!res.ok) throw new Error(`upload: ${res.status} ${await res.text()}`)
  const { document, version } = (await res.json()) as {
    document: { id: string }
    version: { id: string }
  }
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    const { documents } = await call<{
      documents: { id: string; versions: { id: string; status: string; error: string | null }[] }[]
    }>(cookie, 'GET', `/api/shows/${showId}/documents`)
    const status = documents
      .find((d) => d.id === document.id)
      ?.versions.find((v) => v.id === version.id)
    if (status?.status === 'ready') return { documentId: document.id, versionId: version.id }
    if (status?.status === 'failed') throw new Error(`libretto failed to process: ${status.error}`)
    if (Date.now() > deadline) throw new Error(`libretto not ready after ${READY_TIMEOUT_MS} ms`)
    await new Promise((r) => setTimeout(r, 1_000))
  }
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
  if (!res.ok) throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function createShow(cookie: string, title: string): Promise<{ id: string; title: string }> {
  const { organisations } = await call<{ organisations: { id: string }[] }>(
    cookie,
    'GET',
    '/api/me/orgs',
  )
  const { show } = await call<{ show: { id: string; title: string } }>(
    cookie,
    'POST',
    `/api/orgs/${organisations[0].id}/shows`,
    { title },
  )
  return { id: show.id, title: show.title }
}
