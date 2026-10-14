import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { API_URL, APP_URL, AUTH_DIR, apiEnv, REPO_ROOT, RUN_FILE, type RunData } from './env'

/**
 * Creates three fresh users and two shows against the dev database. Every name carries a run
 * suffix, so the suite can run again and again against the persistent dev stack.
 */
export default async function globalSetup() {
  const run = `${Date.now()}`
  const password = randomBytes(18).toString('base64url')
  const users: RunData['users'] = {
    a: { email: `a-${run}@e2e.test`, name: `Alice ${run}` },
    b: { email: `b-${run}@e2e.test`, name: `Bob ${run}` },
    c: { email: `c-${run}@e2e.test`, name: `Carol ${run}` },
  }
  for (const user of Object.values(users)) {
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@binder/api',
        'exec',
        'tsx',
        'src/cli.ts',
        'create-user',
        '--email',
        user.email,
        '--name',
        user.name,
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ...apiEnv(), BINDER_PASSWORD: password },
        stdio: 'pipe',
      },
    )
  }

  const a = await signIn(users.a.email, password)
  const sharedShow = await createShow(a, `Pirates ${run}`)
  await call(a, 'POST', `/api/shows/${sharedShow.id}/members`, {
    email: users.b.email,
    role: 'editor',
  })
  const c = await signIn(users.c.email, password)
  const cShow = await createShow(c, `Carol's show ${run}`)

  mkdirSync(AUTH_DIR, { recursive: true })
  const data: RunData = { password, users, sharedShow, cShow }
  writeFileSync(RUN_FILE, JSON.stringify(data, null, 2))
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
