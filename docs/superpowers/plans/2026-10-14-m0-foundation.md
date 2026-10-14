# Binder M0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Binder that a logged-in user can open, create a show in, upload a script PDF to (text or scanned), have it processed into a searchable PDF with word boxes and thumbnails, view it offline, search it, and do all of the same through the MCP server, with every change logged and synced to other users.

**Architecture:** Postgres is the source of truth. PowerSync (self-hosted, Sync Streams) mirrors each user's shows into SQLite in the browser; writes queue locally and upload to the API, which enforces roles and writes a change log. A single service layer in the API is called by HTTP routes, the sync upload path, and the MCP server. Document processing runs as pg-boss jobs in the API container using OCRmyPDF and poppler. The web app is a Vite PWA that renders pages with PDF.js and caches blobs with the Cache API.

**Tech Stack:** TypeScript 5.x, pnpm 12 workspaces, Biome. API: Hono 4 on @hono/node-server 2, Drizzle 0.45 with `pg`, Better Auth 1.7 with `@better-auth/drizzle-adapter`, pg-boss 12, jose, busboy, `@modelcontextprotocol/server` 2 with `@modelcontextprotocol/hono`, Zod 4. Sync: `journeyapps/powersync-service:1.27.0`, `@powersync/web` 2.4, `@powersync/react` 2.0. Web: Vite 8, React 19, TanStack Router 1.17x, TanStack Query 5, @tanstack/react-virtual 3, pdfjs-dist 6.4, vite-plugin-pwa 2. Tests: Vitest 5, @testcontainers/postgresql 12, Playwright 1.64. Fixtures: pdf-lib 1.17, poppler, Project Gutenberg ebook 808.

**Spec:** `docs/superpowers/specs/2026-10-14-binder-platform-design.md`

## Global Constraints

- Node engines `>=22.22`; `.nvmrc` says `24`; Docker base `node:24-bookworm-slim`. pnpm pinned via `"packageManager": "pnpm@12.11.2"`. TypeScript stays on 5.x until Biome, Vitest, and drizzle-kit confirm 7.x support.
- `packages/core` must remain free of Node-only and browser-only dependencies so it runs in both.
- Identifiers are UUIDv7 generated on the client (`newId()` from `@binder/shared`, backed by the `uuidv7` package). Every row's primary key column is `id text`.
- All show-scoped tables carry `show_id`, `created_at`, `updated_at`, `updated_by`. No soft delete.
- Coordinates everywhere are displayed page space: PDF points, origin bottom-left, after `/Rotate`. A page's stored width and height are displayed dimensions.
- Blob keys: `shows/{showId}/documents/{documentId}/versions/{versionId}/original.pdf`, `.../searchable.pdf`, `.../pages/{index}/thumb.png`, `.../pages/{index}/words.json`. Thumbnails are 160 px wide. Upload limit is 200 MB, checked by magic bytes `%PDF-`.
- OCR mode is `auto` or `never`; `auto` runs `ocrmypdf --redo-ocr --output-type pdf --optimize 0 -l eng`. Failure falls back to a plain copy with `ocr_applied = false` and never blocks `ready`.
- Permissions table (spec 4.1): owner everything; editor show graph, documents, cues in scoped departments; viewer read plus personal layer. Show settings and memberships are owner-only. No public sign-up.
- Sync: PowerSync upload responses are 200 with a `rejected` list for validation and permission failures; 5xx only for transient server failure. Updates are column-level patches. Every accepted operation writes exactly one change log row with before and after values, `via`, and `agent`.
- MCP: every service operation is an MCP tool or has a listed exemption with a reason. Bearer personal access tokens. Page images at most 1600 px on the long side.
- Real show materials never enter git. `fixtures/private/` and `*.tmix` are gitignored.
- Commit after every task with a conventional-commit message. Commits are unsigned if the 1Password signer is unavailable: use `git -c commit.gpgsign=false commit`.

## Suggested models per task

Default Sonnet, medium effort. Opus with high effort where interface semantics are subtle and a mistake would be expensive to unwind: Task 8 (sync write path), Task 9 (sync client and go or no-go), Task 12 (processing pipeline), Task 14 (MCP server), Task 15 (viewer). Never Fable.

## Review Focus

Failure modes the spec implies but that a casual implementation would miss. Each has a pinned test in the owning task.

1. An encrypted or otherwise un-OCR-able PDF must still become `ready` with a visible fallback, never stuck in `processing`. Pinned in Task 12.
2. A blob request whose key contains `..`, a leading slash, or a show id the caller is not a member of must be refused without touching the filesystem outside the root. Pinned in Tasks 3 and 11.
3. An editor whose membership was revoked while offline uploads queued edits: the batch must return 200 with those entries rejected, the rest applied, and the client must converge to the server state without a stuck queue. Pinned in Tasks 8 and 9.
4. A document with mixed page sizes and a rotated page must produce thumbnails, dimensions, and word boxes in displayed orientation, so a cue placed at the top-left of the rotated page lands where the user sees it. Pinned in Task 12.
5. An upload with `Content-Length` over 200 MB must be refused with 413 before the body is read, and a body that lies about its length must be cut off at 200 MB. Pinned in Task 11.

## File structure

```
binder/
  package.json  pnpm-workspace.yaml  .npmrc  .nvmrc  biome.json  tsconfig.base.json  vitest.config.ts
  .github/workflows/ci.yml
  packages/shared/src/{index.ts, roles.ts, ids.ts, types.ts}            # Role, Actor, newId, WordLayer, enums
  packages/db/src/{index.ts, client.ts, migrate.ts, schema/*.ts}        # Drizzle schema + migrations
  packages/db/drizzle/                                                   # generated SQL migrations
  packages/core/src/{index.ts, wordLayer/*, search/*}                   # pure logic
  apps/api/src/{config.ts, app.ts, server.ts, cli.ts, errors.ts}
  apps/api/src/blob/{BlobStore.ts, DiskBlobStore.ts, keys.ts}
  apps/api/src/auth/{auth.ts, mailer.ts, middleware.ts}
  apps/api/src/services/{index.ts, changeLog.ts, tenancy.ts, tokens.ts, documents.ts, pages.ts, search.ts}
  apps/api/src/routes/{health.ts, me.ts, tenancy.ts, tokens.ts, sync.ts, documents.ts, blobs.ts}
  apps/api/src/sync/{token.ts, policy.ts, apply.ts}
  apps/api/src/processing/{queue.ts, documentJob.ts, pageJob.ts, ocrmypdf.ts, poppler.ts, tmp.ts}
  apps/api/src/mcp/{server.ts, auth.ts, tools/*.ts, resources/*.ts, registry.ts}
  apps/api/test/                                                         # Vitest, testcontainers
  apps/web/src/{main.tsx, router.tsx, routes/*, auth/*, api/*, powersync/*, viewer/*, search/*, offline/*, components/*}
  apps/web/e2e/                                                          # Playwright
  fixtures/public/{pirates.txt, README.md}  fixtures/scripts/{make-fixtures.ts, lib.ts, paths.ts}
  fixtures/public/generated/   (gitignored)   fixtures/private/   (gitignored)
  docs/guides/{jayden-style.md, mic-and-dca-practice.md, tmix-format.md}
  deploy/{docker-compose.dev.yml, docker-compose.yml, Dockerfile.api, Dockerfile.web, Caddyfile, README.md}
  deploy/postgres/init.sql  deploy/powersync/{powersync.yaml, sync-config.yaml}
```

---

### Task 1: Monorepo scaffold and `@binder/shared`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `biome.json`, `tsconfig.base.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `README.md`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/roles.ts`, `packages/shared/src/ids.ts`, `packages/shared/src/types.ts`
- Test: `packages/shared/src/roles.test.ts`, `packages/shared/src/ids.test.ts`

**Interfaces:**
- Produces: `type Role = 'owner' | 'editor' | 'viewer'`; `ROLE_RANK: Record<Role, number>` (viewer 0, editor 1, owner 2); `roleAtLeast(role: Role, min: Role): boolean`; `newId(): string` (UUIDv7); `type Via = 'web' | 'sync' | 'mcp'`; `interface Actor { userId: string; via: Via; agent: string | null }`; `type ShowStatus = 'prep' | 'rehearsal' | 'running' | 'archived'`; `type DocumentKind = 'libretto' | 'score' | 'blocking' | 'other'`; `type OcrMode = 'auto' | 'never'`; `type VersionStatus = 'queued' | 'processing' | 'ready' | 'failed'`; `type PageStatus = 'queued' | 'ready' | 'failed'`; `interface Word { t: string; x: number; y: number; w: number; h: number }`; `interface WordLayer { words: Word[]; lines: number[][] }`.
- Workspace packages export TypeScript source: `"exports": { ".": "./src/index.ts" }`. Apps bundle them (tsup for the API, Vite for the web).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/roles.test.ts
import { roleAtLeast, ROLE_RANK } from './roles'
test('owner satisfies editor', () => expect(roleAtLeast('owner', 'editor')).toBe(true))
test('viewer does not satisfy editor', () => expect(roleAtLeast('viewer', 'editor')).toBe(false))
test('ranks are ordered', () => expect(ROLE_RANK.viewer < ROLE_RANK.editor && ROLE_RANK.editor < ROLE_RANK.owner).toBe(true))
// packages/shared/src/ids.test.ts
import { newId } from './ids'
test('newId is a uuid v7 and time-ordered', () => {
  const a = newId(), b = newId()
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(a < b).toBe(true)
})
```

- [ ] **Step 2: Scaffold the workspace so the tests can run**

Root `package.json`: private, `packageManager: pnpm@12.11.2`, `engines.node >=22.22`, scripts `test` (`vitest run`), `lint` (`biome check .`), `typecheck` (`pnpm -r typecheck`). `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `fixtures`. `tsconfig.base.json`: `strict`, `module: ESNext`, `moduleResolution: bundler`, `target: ES2022`, `verbatimModuleSyntax`. Root `vitest.config.ts`: `test.projects: ['packages/*', 'apps/*']`. `packages/shared` depends on `uuidv7@^1.2`. Install pnpm with `curl -fsSL https://get.pnpm.io/install.sh | sh -` if absent.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm install && pnpm vitest run packages/shared`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `roles.ts`, `ids.ts`, `types.ts`, `index.ts`**

`newId` wraps `uuidv7()` from the `uuidv7` package. `types.ts` holds the type aliases and interfaces listed above and nothing else.

- [ ] **Step 5: Run tests and lint to verify they pass**

Run: `pnpm vitest run packages/shared && pnpm biome check .`
Expected: 4 tests PASS, Biome clean.

- [ ] **Step 6: Add CI**

`.github/workflows/ci.yml`: on push and pull request; `pnpm/action-setup` with version 12.11.2; Node 24; `pnpm install --frozen-lockfile`; `pnpm lint`; `pnpm typecheck`; `pnpm test`. Docker is available on `ubuntu-latest` for later testcontainers.

- [ ] **Step 7: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "chore: scaffold pnpm monorepo with shared package and CI"
```

---

### Task 2: `@binder/db` schema, migrations, and the test database

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/index.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/tenancy.ts`, `packages/db/src/schema/documents.ts`, `packages/db/src/schema/changeLog.ts`, `packages/db/drizzle/0000_init.sql` (generated)
- Create: `test/global-setup.ts` (repo root, used by the root Vitest config), `packages/db/test/helpers.ts`
- Test: `packages/db/test/schema.test.ts`

**Interfaces:**
- Produces: `createDb(url: string): { db: Db; pool: pg.Pool }`; `type Db` (the Drizzle instance type); `runMigrations(db: Db): Promise<void>`; schema tables `organisations`, `orgMemberships`, `shows`, `showMemberships`, `personalAccessTokens`, `documents`, `documentVersions`, `pages`, `changeLog`; test helper `getTestDb(): Promise<{ db: Db; truncateAll(): Promise<void> }>` that reads `inject('dbUrl')`.
- Columns (all `id text primaryKey` unless stated; timestamps `timestamptz`):
  - `organisations(id, name, created_at)`
  - `org_memberships(id, organisation_id, user_id, role text ('owner'|'member'), created_at)` unique `(organisation_id, user_id)`
  - `shows(id, organisation_id, title, status text default 'prep', settings jsonb default '{}', created_at, updated_at, updated_by)`
  - `show_memberships(id, show_id, user_id, role text, departments jsonb default '["*"]', created_at)` unique `(show_id, user_id)`
  - `personal_access_tokens(id, user_id, name, token_hash text unique, show_scope jsonb default '"*"', created_at, last_used_at, expires_at, revoked_at)`
  - `documents(id, show_id, kind text, title, current_version_id text, sort_order integer default 0, ocr_mode text default 'auto', snap_to_text boolean, created_at, updated_at, updated_by)`
  - `document_versions(id, show_id, document_id, version_number integer, label text, original_key text, searchable_key text, page_count integer, uploaded_by, uploaded_at, status text default 'queued', error text)` unique `(document_id, version_number)`
  - `pages(id, show_id, document_version_id, index integer, width real, height real, rotation integer, thumb_key text, words_key text, ocr_applied boolean default false, status text default 'queued', error text)` unique `(document_version_id, index)`
  - `change_log(seq bigserial primaryKey, show_id, user_id, via text, agent text, client_ts timestamptz, server_ts timestamptz default now(), batch_id text, table_name text, row_id text, op text, before jsonb, after jsonb)` index `(show_id, seq)`
- Better Auth tables are added in Task 4 by its CLI into `packages/db/src/schema/auth.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/schema.test.ts
import { getTestDb } from './helpers'; import { organisations, shows, showMemberships } from '../src/schema'; import { newId } from '@binder/shared'
test('migrations apply and a show with a membership round-trips', async () => {
  const { db } = await getTestDb()
  const orgId = newId(), showId = newId()
  await db.insert(organisations).values({ id: orgId, name: 'TTP' })
  await db.insert(shows).values({ id: showId, organisationId: orgId, title: 'Pirates', updatedBy: 'u1' })
  await db.insert(showMemberships).values({ id: newId(), showId, userId: 'u1', role: 'owner' })
  const rows = await db.select().from(shows)
  expect(rows[0]).toMatchObject({ title: 'Pirates', status: 'prep', settings: {} })
})
test('duplicate membership is rejected', async () => { /* same (showId,userId) twice -> rejects */ })
```

- [ ] **Step 2: Write the test database harness**

`test/global-setup.ts` starts `PostgreSqlContainer('postgres:17')` once per run, provides `dbUrl` via `project.provide`, stops it in teardown. The root `vitest.config.ts` gets `globalSetup: ['./test/global-setup.ts']`. `packages/db/test/helpers.ts`: `getTestDb()` creates the pool once per worker, runs `runMigrations`, returns `truncateAll` that truncates every table except `drizzle.__drizzle_migrations` with `RESTART IDENTITY CASCADE`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/db`
Expected: FAIL, schema module missing.

- [ ] **Step 4: Implement the schema, client, and migrations**

Drizzle `pgTable` definitions per the column list, camelCase property names mapped to snake_case columns. `client.ts`: `createDb` with `drizzle(new pg.Pool({ connectionString }))` from `drizzle-orm/node-postgres`. `migrate.ts`: `migrate(db, { migrationsFolder })` resolved relative to the package with `import.meta.url`. `drizzle.config.ts`: dialect postgresql, `schemaFilter: ['public']`, `tablesFilter: ['!pgboss*']`. Generate `0000_init.sql` with `pnpm --filter @binder/db drizzle-kit generate`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/db`
Expected: 2 tests PASS (first run pulls the postgres:17 image).

- [ ] **Step 6: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(db): initial schema, migrations, and test database harness"
```

---

### Task 3: API skeleton, errors, and the disk blob store

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsup.config.ts`, `apps/api/src/config.ts`, `apps/api/src/errors.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/blob/BlobStore.ts`, `apps/api/src/blob/DiskBlobStore.ts`, `apps/api/src/blob/keys.ts`
- Test: `apps/api/test/app.test.ts`, `apps/api/test/diskBlobStore.test.ts`, `apps/api/test/keys.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` with keys `DATABASE_URL`, `BLOB_ROOT`, `PORT` (default 3000), `APP_ORIGIN`, `AUTH_SECRET`, `POWERSYNC_JWT_SECRET` (base64url), `POWERSYNC_URL`, `SMTP_URL?`, `ALLOW_SIGNUP` (default false), validated with Zod 4 and failing fast with the missing key named.
- `class AppError extends Error { code: 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'payload_too_large'; status: number }` plus helpers `unauthenticated()`, `forbidden(msg?)`, `notFound(msg?)`, `invalid(msg)`, `conflict(msg)`.
- `interface BlobStore { put(key: string, body: Readable | Uint8Array, contentType: string): Promise<void>; get(key: string): Promise<{ stream: Readable; size: number; contentType: string } | null>; exists(key: string): Promise<boolean>; delete(key: string): Promise<void>; localPath?(key: string): string }` and `class DiskBlobStore implements BlobStore` (content type stored in a sidecar `<file>.meta.json`; `localPath` returns the absolute path for processing jobs).
- `validateBlobKey(key: string): string` returns the key or throws `invalid`; `showIdFromKey(key: string): string | null`.
- `interface AppDeps { config: Config; db: Db; blobs: BlobStore }`; `createApp(deps: AppDeps): Hono<AppEnv>` where `AppEnv = { Variables: { deps: AppDeps; user?: { id: string; email: string; name: string }; actor?: Actor } }`. `app.onError` maps `AppError` to `{ error: code, message }` with its status, anything else to 500 with a logged stack. Routes are mounted under `/api`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/app.test.ts
test('GET /api/health returns ok', async () => {
  const app = createApp(testDeps()); const res = await app.request('/api/health')
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ ok: true })
})
// apps/api/test/keys.test.ts
test.each(['../x', '/shows/a', 'shows/a/../b', 'shows/a/%2e%2e/b', 'shows/a/b c'])('rejects %s', k => expect(() => validateBlobKey(k)).toThrow())
test('accepts a well-formed key and extracts show id', () => {
  const k = 'shows/01HZZ/documents/01HZY/versions/01HZX/original.pdf'
  expect(validateBlobKey(k)).toBe(k); expect(showIdFromKey(k)).toBe('01HZZ')
})
// apps/api/test/diskBlobStore.test.ts
test('put, get, exists, delete round-trip with content type', async () => { /* tmp dir root; put Uint8Array; get -> stream to buffer equals; contentType 'application/pdf'; size; exists true; delete; exists false; get null */ })
test('never writes outside root', async () => { await expect(store.put('../escape', new Uint8Array(1), 'x')).rejects.toThrow() })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/api`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement config, errors, app, health, blob store, keys**

Key grammar: segments of `[A-Za-z0-9._-]+` joined by `/`, must start with `shows/`, no segment equal to `.` or `..`, no percent signs. `DiskBlobStore.put` writes to a temp file in the root then renames. `server.ts` loads config, `createDb`, `runMigrations`, `DiskBlobStore(config.BLOB_ROOT)`, `serve({ fetch: app.fetch, port })`. Build with tsup (`entry: ['src/server.ts', 'src/cli.ts']`, `format: esm`, `noExternal: [/^@binder\//]`). Scripts: `dev` (`tsx watch src/server.ts`), `build`, `start`, `test`, `typecheck`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/api`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(api): hono skeleton, config, errors, disk blob store"
```

---

### Task 4: Authentication with Better Auth

**Files:**
- Create: `apps/api/src/auth/auth.ts`, `apps/api/src/auth/mailer.ts`, `apps/api/src/auth/middleware.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/cli.ts`, `packages/db/src/schema/auth.ts` (generated by the Better Auth CLI), `packages/db/drizzle/0001_auth.sql` (generated)
- Modify: `apps/api/src/app.ts` (mount auth handler and the sign-up guard)
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Produces: `auth` (the Better Auth instance) built with `drizzleAdapter(db, { provider: 'pg', schema })`, `emailAndPassword: { enabled: true }`, `plugins: [magicLink({ sendMagicLink })]`, `trustedOrigins: [config.APP_ORIGIN]`, `advanced.database.generateId: () => newId()`, `basePath: '/api/auth'`.
- `sendMail({ to, subject, text }): Promise<void>` sends via nodemailer when `SMTP_URL` is set, otherwise logs the message at info level.
- `requireUser` Hono middleware: reads `auth.api.getSession({ headers: c.req.raw.headers })`, sets `c.var.user = { id, email, name }` and `c.var.actor = { userId, via: 'web', agent: null }`, throws `unauthenticated()` when absent.
- `GET /api/me` returns `{ user }`.
- `POST /api/auth/sign-up/email` is answered 403 by a guard middleware unless `ALLOW_SIGNUP=true`.
- CLI: `cli create-user --email <e> --name <n> --password <p>` calls `auth.api.signUpEmail({ body })` directly (not over HTTP) and prints the user id.
- Test helper `createTestUser(app, { email, name, password }): Promise<{ id: string; cookie: string }>` that creates via `auth.api.signUpEmail` and signs in over HTTP to capture the cookie.

- [ ] **Step 1: Write the failing tests**

```ts
test('sign in sets a session cookie and /api/me returns the user', async () => {
  const u = await createTestUser(app, { email: 'j@x.test', name: 'Jayden', password: 'correct horse' })
  const me = await app.request('/api/me', { headers: { cookie: u.cookie } })
  expect(me.status).toBe(200); expect((await me.json()).user.email).toBe('j@x.test')
})
test('/api/me without a cookie is 401', async () => expect((await app.request('/api/me')).status).toBe(401))
test('public sign-up is refused', async () => {
  const res = await app.request('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@x.test', name: 'A', password: 'password123' }) })
  expect(res.status).toBe(403)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/api/test/auth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Generate the auth schema and implement**

Run `cd apps/api && pnpm dlx auth@1.7.7 generate --config src/auth/auth.ts --output ../../packages/db/src/schema/auth.ts`, re-export from `schema/index.ts`, then `pnpm --filter @binder/db drizzle-kit generate` to produce `0001_auth.sql`. Mount with `app.all('/api/auth/*', c => auth.handler(c.req.raw))` after the sign-up guard. The `user` table from Better Auth is the user table for the whole app; our tables reference `user.id` as `text`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/api/test/auth.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(api): better-auth sessions, magic link mailer, create-user cli"
```

---

### Task 5: Tenancy service and routes

**Files:**
- Create: `apps/api/src/services/changeLog.ts`, `apps/api/src/services/tenancy.ts`, `apps/api/src/services/index.ts`, `apps/api/src/routes/tenancy.ts`
- Modify: `apps/api/src/auth/auth.ts` (user create hook), `apps/api/src/app.ts`
- Test: `apps/api/test/tenancy.test.ts`

**Interfaces:**
- Produces, in `services/changeLog.ts`: `logChange(tx: Db, e: { showId: string; actor: Actor; batchId: string; table: string; rowId: string; op: 'insert' | 'update' | 'delete'; before: Record<string, unknown> | null; after: Record<string, unknown> | null; clientTs?: Date }): Promise<void>`.
- Produces, in `services/tenancy.ts`: `createOrganisation(db, actor, { name }): Promise<Organisation>` (creator becomes org owner); `createShow(db, actor, { organisationId, title }): Promise<Show>` (requires org membership; creator becomes show owner; writes change log insert); `listShows(db, actor): Promise<{ active: Show[]; archived: Show[] }>`; `listOrganisations(db, actor): Promise<Organisation[]>`; `getShowRole(db, userId, showId): Promise<Role | null>`; `requireShowRole(db, userId, showId, min: Role): Promise<Role>` throws `notFound` when no membership and `forbidden` when below `min`; `addShowMember(db, actor, { showId, email, role, departments }): Promise<ShowMembership>` (owner only; `notFound` if no such user); `updateShow(db, actor, { showId, patch: { title?: string; status?: ShowStatus; settings?: object } }): Promise<Show>` (owner only; logs before and after of changed columns only).
- `services/index.ts` exports `SERVICE_OPERATIONS: readonly string[]` listing every exported operation name (used by the MCP parity test in Task 14).
- Routes: `GET /api/me/orgs`, `POST /api/orgs {name}`, `GET /api/me/shows`, `POST /api/orgs/:orgId/shows {title}`, `PATCH /api/shows/:showId {title?, status?, settings?}`, `POST /api/shows/:showId/members {email, role, departments}`. All behind `requireUser`.
- Hook: `databaseHooks.user.create.after` creates an organisation named `<name>'s organisation` with the new user as owner.

- [ ] **Step 1: Write the failing tests**

```ts
test('a new user gets a personal organisation', ...)            // createTestUser then listOrganisations length 1
test('owner can rename and archive, editor cannot', ...)        // updateShow as editor -> AppError forbidden
test('listShows splits archived from active', ...)              // two shows, one archived
test('addShowMember by editor is forbidden; unknown email is not_found', ...)
test('updateShow writes a change log row with only changed columns', async () => {
  await updateShow(db, owner, { showId, patch: { title: 'B' } })
  const [row] = await db.select().from(changeLog).where(eq(changeLog.rowId, showId))
  expect(row).toMatchObject({ tableName: 'shows', op: 'update', before: { title: 'A' }, after: { title: 'B' }, via: 'web' })
})
test('HTTP: PATCH /api/shows/:id as viewer is 403', ...)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/api/test/tenancy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement services, routes, and the hook**

Every mutating service runs in `db.transaction`, reads the row before changing it, writes with `.returning()`, and calls `logChange` inside the same transaction with `batchId = newId()` unless the caller supplies one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/api/test/tenancy.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(api): organisations, shows, memberships, change log"
```

---

### Task 6: Personal access tokens

**Files:**
- Create: `apps/api/src/services/tokens.ts`, `apps/api/src/routes/tokens.ts`, `apps/api/src/auth/bearer.ts`
- Modify: `apps/api/src/services/index.ts`, `apps/api/src/app.ts`, `apps/api/src/cli.ts` (`create-token --email --name --scope`)
- Test: `apps/api/test/tokens.test.ts`

**Interfaces:**
- Produces: `createToken(db, actor, { name, showScope: '*' | string[], expiresAt?: Date }): Promise<{ token: string; record: PersonalAccessToken }>` where `token` is `bnd_` plus 43 base64url characters from 32 random bytes, stored as SHA-256 hex; `listTokens(db, actor)`; `revokeToken(db, actor, { tokenId })`; `authenticateToken(db, plain: string): Promise<{ userId: string; tokenId: string; showScope: '*' | string[] } | null>` (null when unknown, revoked, or expired; updates `last_used_at` at most once per minute).
- `bearerAuth` middleware: if an `Authorization: Bearer bnd_...` header is present, authenticates it and sets `c.var.user` and `c.var.actor = { userId, via: 'mcp', agent: c.req.header('user-agent') ?? null }`; the session middleware is tried first, so cookies and bearer both work on `/api/*`.
- `tokenAllowsShow(scope, showId): boolean`.
- Routes: `GET /api/me/tokens`, `POST /api/me/tokens {name, showScope, expiresAt?}` returns the plain token once, `DELETE /api/me/tokens/:id`.

- [ ] **Step 1: Write the failing tests**

```ts
test('created token authenticates and the plain token is never stored', ...)   // hash in db != plain; authenticateToken(plain).userId
test('revoked and expired tokens do not authenticate', ...)
test('bearer header sets actor via mcp with user-agent as agent', ...)         // GET /api/me with bearer -> 200
test('tokenAllowsShow respects a list scope', () => { expect(tokenAllowsShow(['a'], 'b')).toBe(false); expect(tokenAllowsShow('*', 'b')).toBe(true) })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/api/test/tokens.test.ts`

- [ ] **Step 3: Implement service, middleware, routes, CLI**

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/api/test/tokens.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(api): personal access tokens with bearer auth"
```

---

### Task 7: PowerSync service, dev compose, and sync token

**Files:**
- Create: `deploy/docker-compose.dev.yml`, `deploy/postgres/init.sql`, `deploy/powersync/powersync.yaml`, `deploy/powersync/sync-config.yaml`, `deploy/scripts/powersync-smoke.sh`, `apps/api/src/sync/token.ts`, `apps/api/src/routes/sync.ts`, `.env.example`
- Test: `apps/api/test/syncToken.test.ts`

**Interfaces:**
- Produces: `mintPowerSyncToken(userId: string, secretBase64Url: string, opts?: { ttlSeconds?: number }): Promise<{ token: string; expiresAt: Date }>` using `jose` `SignJWT`, HS256, header `kid: 'binder-1'`, claims `sub = userId`, `aud = ['powersync']`, `iat`, `exp = iat + 3600`.
- `GET /api/sync/token` (session or bearer) returns `{ token, expiresAt, endpoint: config.POWERSYNC_URL }`.
- `docker-compose.dev.yml`: `postgres:17` with `command: postgres -c wal_level=logical`, port 5432, `init.sql` mounted into `/docker-entrypoint-initdb.d/`; `powersync` from `journeyapps/powersync-service:1.27.0` on port 8080 with `PS_DATA_SOURCE_URI`, `PS_STORAGE_SOURCE_URI` (a second database `powersync_storage` on the same server), `PS_JWT_SECRET`; healthcheck on `/probes/liveness`.
- `init.sql`: creates the `powersync_storage` database and the role `powersync_role WITH REPLICATION BYPASSRLS LOGIN`, and grants SELECT on all public tables plus default privileges for future tables. The publication is not created here because the tables do not exist yet; migration `packages/db/drizzle/0002_publication.sql` (hand-written, registered in the drizzle journal) runs `CREATE PUBLICATION powersync FOR TABLE shows, show_memberships, documents, document_versions, pages;` inside a `DO` block that skips when it already exists. The publication name must be `powersync`.
- `powersync.yaml`: `replication.connections[0]` type postgresql with `!env PS_DATA_SOURCE_URI` and `sslmode: disable`; `storage.type: postgresql` with `!env PS_STORAGE_SOURCE_URI`; `port: 8080`; `sync_config.path: sync-config.yaml`; `client_auth.jwks.keys: [{ kty: oct, alg: HS256, kid: binder-1, k: !env PS_JWT_SECRET }]`; `client_auth.audience: ['powersync']`; `healthcheck.probes.use_http: true`.
- `sync-config.yaml` (Sync Streams, edition 3):

```yaml
config:
  edition: 3
with:
  user_shows: SELECT show_id FROM show_memberships WHERE user_id = auth.user_id()
streams:
  membership:
    auto_subscribe: true
    queries:
      - SELECT * FROM show_memberships WHERE user_id = auth.user_id()
      - SELECT * FROM shows WHERE id IN user_shows
  show_data:
    auto_subscribe: true
    queries:
      - SELECT * FROM documents WHERE show_id IN user_shows
      - SELECT * FROM document_versions WHERE show_id IN user_shows
      - SELECT * FROM pages WHERE show_id IN user_shows
```

  Archived shows are included in M0; the on-demand archived subscription is M2.

- [ ] **Step 1: Write the failing test**

```ts
test('sync token verifies with the shared secret and carries the right claims', async () => {
  const { token } = await mintPowerSyncToken('user-1', secret)
  const { payload, protectedHeader } = await jwtVerify(token, base64url.decode(secret), { audience: 'powersync' })
  expect(payload.sub).toBe('user-1'); expect(protectedHeader.kid).toBe('binder-1'); expect(payload.exp! - payload.iat!).toBe(3600)
})
test('GET /api/sync/token requires auth and returns the endpoint', ...)
```

- [ ] **Step 2: Run test to verify it fails**, then **Step 3: Implement token, route, compose, config files, `.env.example`**, then **Step 4: Run tests to verify they pass**.

- [ ] **Step 5: Bring the stack up and smoke it**

Run: `docker compose -f deploy/docker-compose.dev.yml up -d && pnpm --filter @binder/api dev` (in another shell) `&& bash deploy/scripts/powersync-smoke.sh`
The smoke script: waits for `GET http://localhost:8080/probes/liveness` to return 200, mints a token through `GET /api/sync/token` with a test user's cookie, and issues `curl -N -H "Authorization: Bearer $TOKEN" -X POST http://localhost:8080/sync/stream -d '{}'` expecting an HTTP 200 and at least one line of output within 10 seconds. Print PASS or FAIL. If the service rejects `sync-config.yaml`, read the container log and fix the YAML; the config above follows the Sync Streams documentation.

- [ ] **Step 6: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(sync): powersync service config, dev compose, sync token"
```

---
### Task 8: Sync upload write path

**Files:**
- Create: `apps/api/src/sync/policy.ts`, `apps/api/src/sync/apply.ts`
- Modify: `apps/api/src/routes/sync.ts`, `apps/api/src/services/index.ts`
- Test: `apps/api/test/syncUpload.test.ts`

**Interfaces:**
- Consumes: `requireShowRole`, `logChange` (Task 5).
- Produces:

```ts
type CrudOp = 'PUT' | 'PATCH' | 'DELETE'
interface CrudEntry { table: string; id: string; op: CrudOp; data?: Record<string, unknown>; clientTs?: string }
interface UploadRequest { batchId: string; entries: CrudEntry[] }
type RejectReason = 'unknown_table' | 'unsupported_op' | 'forbidden' | 'not_found' | 'invalid'
interface Rejection { index: number; table: string; id: string; reason: RejectReason; message: string }
applyCrudBatch(db: Db, actor: Actor, req: UploadRequest): Promise<{ applied: number; rejected: Rejection[] }>
```

- `policy.ts`: `SYNC_TABLES: Record<string, { showIdOf: (row) => string; writable: string[]; minRole: Role; ops: CrudOp[] }>` with exactly two entries in M0: `shows: { showIdOf: r => r.id, writable: ['title', 'status', 'settings'], minRole: 'owner', ops: ['PATCH'] }` and `documents: { showIdOf: r => r.show_id, writable: ['title', 'kind', 'ocr_mode', 'snap_to_text', 'sort_order'], minRole: 'editor', ops: ['PATCH'] }`.
- Semantics: each entry is processed in its own savepoint inside one transaction; a rejected entry rolls back only itself. PATCH keeps only `writable` columns; if nothing remains, reject `invalid`. The row is read before the write for `before`; a missing row rejects `not_found`. `updated_at` and `updated_by` are set by the server. `clientTs` is parsed into the change log's `client_ts`; the batch id is the request's.
- `POST /api/sync/upload` validates the body with Zod (max 500 entries), calls `applyCrudBatch` with `actor.via = 'sync'`, and always responds 200 `{ applied, rejected }`. A database connectivity error responds 503.

- [ ] **Step 1: Write the failing tests**

```ts
test('owner PATCH on shows applies and logs before/after', ...)             // title A->B; change_log via 'sync', batch_id = req.batchId, client_ts set
test('editor PATCH on shows is rejected forbidden, other entries still apply', ...)
test('viewer PATCH on documents is rejected forbidden', ...)
test('unknown table and PUT are rejected with the right reasons', ...)       // 'unknown_table', 'unsupported_op'
test('PATCH with only non-writable columns is rejected invalid', ...)        // { show_id: 'x' } on documents
test('PATCH on a row the user is not a member of is not_found', ...)
test('HTTP: a batch with one bad entry returns 200 with one rejection', ...)
test('revoked membership mid-queue: all entries rejected, response is still 200', ...)   // Review Focus 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/api/test/syncUpload.test.ts`

- [ ] **Step 3: Implement policy and apply**

Column patches use Drizzle `update(table).set(subset).where(eq(id))`. Savepoints via `tx.transaction(async sp => ...)` per entry with the rejection captured from the thrown `AppError`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/api/test/syncUpload.test.ts`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(sync): upload write path with column patches and change log"
```

---

### Task 9: Web shell, PowerSync client, home screen, and the sync go or no-go

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/router.tsx`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/login.tsx`, `apps/web/src/routes/index.tsx`, `apps/web/src/routes/shows.$showId.tsx` (stub), `apps/web/src/routes/settings.tokens.tsx`, `apps/web/src/auth/client.ts`, `apps/web/src/api/client.ts`, `apps/web/src/powersync/schema.ts`, `apps/web/src/powersync/db.ts`, `apps/web/src/powersync/connector.ts`, `apps/web/src/powersync/provider.tsx`, `apps/web/src/components/SyncStatus.tsx`, `apps/web/src/components/Notices.tsx`, `apps/web/src/test/setup.ts`, `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/global-setup.ts`, `apps/web/e2e/auth.setup.ts`, `apps/web/e2e/sync.spec.ts`
- Test: `apps/web/src/powersync/connector.test.ts`, `apps/web/e2e/sync.spec.ts`

**Interfaces:**
- Consumes: `GET /api/sync/token`, `POST /api/sync/upload` (Task 8), tenancy and token routes (Tasks 5, 6).
- Produces: `AppSchema` with tables `shows`, `show_memberships`, `documents`, `document_versions`, `pages` whose columns mirror Task 2 (text for uuid, jsonb, and timestamps; integer for booleans and integers; real for width and height), no `id` declared.
- `createPowerSync(): PowerSyncDatabase` with `database: { dbFilename: 'binder.sqlite', vfs: WASQLiteVFS.OPFSCoopSyncVFS }`.
- `class ApiConnector implements PowerSyncBackendConnector`: `fetchCredentials()` calls `GET /api/sync/token` and returns `{ endpoint, token, expiresAt }`; `uploadData(db)` takes `getNextCrudTransaction()`, maps entries to `CrudEntry` (`UpdateType.PUT → 'PUT'`, `PATCH → 'PATCH'`, `DELETE → 'DELETE'`, `data = opData`), posts `{ batchId: tx.transactionId ?? newId(), entries }`, on 200 pushes each rejection into the notices store and calls `tx.complete()`; on non-2xx throws so PowerSync retries.
- `toCrudEntries(crud: CrudEntry[]): CrudEntryWire[]` pure mapper, unit-tested. `CrudEntryWire` is Task 8's `CrudEntry` type re-declared in `packages/shared` (move it there in this task) and renamed on the client to avoid clashing with PowerSync's own `CrudEntry` class.
- `api/client.ts`: `api.get/post/patch/del(path, body?)` with `credentials: 'include'`, throwing `ApiError { status, code, message }`.
- Vite: `@vitejs/plugin-react`, `@tanstack/router-plugin`, `optimizeDeps.exclude: ['@powersync/web']`, `worker.format: 'es'`, dev proxy `/api` and `/blobs` to `http://localhost:3000`; env `VITE_POWERSYNC_URL` (dev `http://localhost:8080`).
- Screens: login (email and password, magic link request); home lists shows from `useQuery('SELECT * FROM shows ORDER BY title')` split by `status = 'archived'`, with "New show" (POST to the API using the user's first organisation from `GET /api/me/orgs`) and inline rename (`db.execute('UPDATE shows SET title = ? WHERE id = ?')`); settings page lists and creates tokens, showing the plain token once; `SyncStatus` shows connected, pending count from `useStatus()`, or offline.

- [ ] **Step 1: Write the failing unit test**

```ts
test('maps PowerSync crud entries to the wire format', () => {
  const entries = toCrudEntries([{ op: UpdateType.PATCH, table: 'shows', id: 'a', opData: { title: 'B' } } as any])
  expect(entries).toEqual([{ table: 'shows', id: 'a', op: 'PATCH', data: { title: 'B' } }])
})
```

- [ ] **Step 2: Scaffold the app and make the unit test pass**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 3: Write the Playwright sync test**

`global-setup.ts` runs `pnpm --filter @binder/api cli create-user` for `a@e2e.test` (owner) and `b@e2e.test`, then uses the API to create show "Pirates" as A and add B as editor. `auth.setup.ts` logs each in and saves storage state per user. `playwright.config.ts` has `webServer` entries for the API (`url: http://localhost:3000/api/health`) and Vite (`url: http://localhost:5173`), `use.serviceWorkers: 'block'` except in offline specs.

```ts
test('edits sync between two users, survive offline, and rejections converge', async ({ browser }) => {
  const a = await browser.newContext({ storageState: 'e2e/.auth/a.json' }); const b = await browser.newContext({ storageState: 'e2e/.auth/b.json' })
  // A renames Pirates -> Pirates II; B sees it within 5s
  // A goes offline (a.setOffline(true)), renames to Pirates III, reloads: still Pirates III (local persistence)
  // A goes online: B sees Pirates III within 10s
  // B (editor) renames to Nope: B sees a rejection notice and the title converges back to Pirates III within 10s
})
```

- [ ] **Step 4: Run the e2e test to verify it fails, implement the screens and connector, run until it passes**

Run: `docker compose -f deploy/docker-compose.dev.yml up -d && pnpm --filter @binder/web e2e`
Expected: PASS.

- [ ] **Step 5: Record the go or no-go**

Append to the spec, section 3.8, an addendum "Sync spike result, <date>: GO" (or NO-GO with the failing criterion and the switch to the ElectricSQL fallback, which stops this plan for re-planning of Tasks 7 to 9). Also note the Swift SDK smoke test as a manual follow-up for Jayden.

- [ ] **Step 6: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): app shell, powersync client, home and token screens, sync e2e"
```

---

### Task 10: Public fixtures

**Files:**
- Create: `fixtures/package.json`, `fixtures/public/pirates.txt`, `fixtures/public/README.md`, `fixtures/scripts/lib.ts`, `fixtures/scripts/make-fixtures.ts`, `fixtures/scripts/paths.ts`
- Modify: `.gitignore` (`fixtures/public/generated/`)
- Test: `fixtures/scripts/fixtures.test.ts`

**Interfaces:**
- Produces: `FIXTURES = { librettoText, librettoPdf, scanPdf, mixedPdf }` absolute paths under `fixtures/public/generated/`; `ensureFixtures(): Promise<typeof FIXTURES>` generates when any file is missing; `textToPdf(text: string, opts: { pageSize: 'A4' | 'Letter'; fontSize: number; linesPerPage: number }): Promise<Uint8Array>` (pdf-lib, Helvetica); `rasterisePages(pdfPath: string, pages: number[], dpi: number): Promise<Uint8Array>` (pdftoppm to PNG, then pdf-lib `embedPng` into an image-only PDF at the original page size); `makeMixedPdf(): Promise<Uint8Array>`.
- `pirates.txt`: the text of "The Pirates of Penzance" sliced from Project Gutenberg ebook 808 (`https://www.gutenberg.org/cache/epub/808/pg808.txt`), from its title heading to the start of the next play, with the Gutenberg header and trademark removed (the licence permits redistribution without them). `README.md` states the source and that the text is public domain.
- Generated files: `pirates-libretto.pdf` (A4, 11 pt, 48 lines per page, so roughly 45 pages), `pirates-scan.pdf` (first 8 pages of the libretto rasterised at 150 dpi, image-only), `mixed.pdf` (page 1 A4 portrait text "PAGE ONE PORTRAIT"; page 2 A4 with `/Rotate 90` and the text "ROTATED" drawn so it appears top-left in displayed orientation; page 3 Letter text "PAGE THREE LETTER"; page 4 the rasterised scan of page 1).

- [ ] **Step 1: Write the failing test**

```ts
test('fixtures generate with the expected page counts and kinds', async () => {
  const f = await ensureFixtures()
  expect(await pageCount(f.librettoPdf)).toBeGreaterThan(30)
  expect(await pageCount(f.scanPdf)).toBe(8)
  expect(await pageCount(f.mixedPdf)).toBe(4)
  expect(await hasText(f.scanPdf, 1)).toBe(false)     // pdftotext yields no words
  expect(await hasText(f.librettoPdf, 1)).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**, **Step 3: Download and slice `pirates.txt`, implement `lib.ts` and `make-fixtures.ts`** (script `pnpm fixtures` at root), **Step 4: Run to verify it passes**.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(fixtures): public domain libretto, synthetic scan, mixed-page generator"
```

---

### Task 11: Document upload, versions, and blob serving

**Files:**
- Create: `apps/api/src/services/documents.ts`, `apps/api/src/routes/documents.ts`, `apps/api/src/routes/blobs.ts`, `apps/api/src/upload/multipart.ts`, `apps/api/src/processing/types.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/services/index.ts`
- Test: `apps/api/test/documents.test.ts`, `apps/api/test/blobs.test.ts`

**Interfaces:**
- Consumes: `requireShowRole`, `logChange`, `BlobStore`, fixtures.
- Produces: `interface JobQueue { enqueueDocumentProcess(versionId: string): Promise<void> }` (in `processing/types.ts`; tests pass a recording fake); `AppDeps` gains `jobs: JobQueue`.
- `createDocument(db, blobs, jobs, actor, { showId, kind, title, ocrMode?, file: Readable, declaredSize?: number }): Promise<{ document: Document; version: DocumentVersion }>` (editor); `addDocumentVersion(db, blobs, jobs, actor, { documentId, label, file, declaredSize? }): Promise<DocumentVersion>` (editor; `version_number` = max + 1); `listDocuments(db, actor, { showId }): Promise<Array<Document & { versions: DocumentVersion[] }>>`; `getDocumentVersion(db, actor, { versionId }): Promise<DocumentVersion & { pages: Page[] }>`; `updateDocument(db, actor, { documentId, patch: { title?, kind?, ocrMode?, snapToText?, sortOrder? } })` (editor, logged).
- `readPdfUpload(c: Context, maxBytes: number): Promise<{ fields: Record<string, string>; file: { stream: Readable; filename: string } }>` using busboy on `c.req.raw.body`; rejects with `payload_too_large` when `Content-Length` exceeds `maxBytes` before reading, and when the counted bytes exceed it mid-stream (destroying the stream); rejects `invalid` when the first five bytes are not `%PDF-`.
- Routes: `POST /api/shows/:showId/documents` (multipart: `file`, `kind`, `title`, optional `ocrMode`) → 201; `POST /api/shows/:showId/documents/:docId/versions` (multipart: `file`, `label`) → 201; `GET /api/shows/:showId/documents` → list; `GET /blobs/*` → streams the blob after `validateBlobKey`, `showIdFromKey`, and `requireShowRole(viewer)`; responds 404 when missing, 400 on a bad key, with `Content-Type`, `Content-Length`, and `Cache-Control: private, max-age=31536000, immutable` (keys are content-addressed by version id so they never change).

- [ ] **Step 1: Write the failing tests**

```ts
test('editor uploads the libretto: 201, version queued, original stored, job enqueued', ...)
test('viewer upload is 403; non-PDF is 400; over-size Content-Length is 413 with no blob written', ...)   // Review Focus 5
test('a body longer than its Content-Length is cut at 200MB', ...)                                        // stream 201MB with header 100MB -> 413, no blob
test('second upload to the same document is version 2', ...)
test('GET /blobs streams the PDF to a member with content-length, 403 to a non-member, 400 on traversal', ...)   // Review Focus 2
```

- [ ] **Step 2: Run tests to verify they fail**, **Step 3: Implement**, **Step 4: Run tests to verify they pass** (`pnpm vitest run apps/api/test/documents.test.ts apps/api/test/blobs.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(api): document upload, versions, and blob serving"
```

---

### Task 12: Processing pipeline (OCRmyPDF, poppler, word layers, thumbnails)

**Files:**
- Create: `apps/api/src/processing/queue.ts`, `apps/api/src/processing/documentJob.ts`, `apps/api/src/processing/pageJob.ts`, `apps/api/src/processing/ocrmypdf.ts`, `apps/api/src/processing/poppler.ts`, `apps/api/src/processing/tmp.ts`, `packages/core/package.json`, `packages/core/src/index.ts`, `packages/core/src/wordLayer/fromPopplerBbox.ts`
- Modify: `apps/api/src/server.ts` (start the queue), `deploy/docker-compose.dev.yml` (nothing; tools run on the host in dev)
- Test: `packages/core/src/wordLayer/fromPopplerBbox.test.ts`, `apps/api/test/processing.test.ts`

**Interfaces:**
- Consumes: `BlobStore.localPath`, `JobQueue`, fixtures.
- Produces, in core: `fromPopplerBbox(xhtml: string): { width: number; height: number; layer: WordLayer }` parsing `pdftotext -bbox-layout` output (`<page width height>`, `<block>`, `<line>`, `<word xMin yMin xMax yMax>`), converting each word to displayed space with `x = xMin`, `y = height - yMax`, `w = xMax - xMin`, `h = yMax - yMin`, and `lines` as the word indices of each `<line>` in order.
- Produces, in the API: `runOcrmypdf(input: string, output: string, opts: { mode: OcrMode }): Promise<{ ocrApplied: boolean; exitCode: number | null; stderr: string }>`; mode `never` copies; mode `auto` spawns `ocrmypdf --redo-ocr --output-type pdf --optimize 0 -l eng --jobs 2 <input> <output>` with a 30-minute timeout; exit 0 → `ocrApplied: true`; any other exit (2 invalid input, 6 already has text, 7 child failure, 8 encrypted) copies input to output, `ocrApplied: false`, and returns the code for the version's `error` field.
- `pdfInfo(path: string): Promise<{ pageCount: number; pages: Array<{ width: number; height: number; rotation: number }> }>` from `pdfinfo -f 1 -l <n>`, swapping width and height when rotation is 90 or 270 so dimensions are displayed.
- `renderThumbnail(pdf: string, pageIndex: number, outPrefix: string): Promise<string>` runs `pdftoppm -png -f <n> -l <n> -scale-to-x 160 -scale-to-y -1 -singlefile` and returns the PNG path. `renderPageImage(pdf, pageIndex, outPrefix, maxPx = 1600): Promise<string>` runs `pdftoppm -jpeg -scale-to <maxPx>` (used by the MCP in Task 14).
- `extractBboxXhtml(pdf: string, pageIndex: number): Promise<string>` runs `pdftotext -bbox-layout -f <n> -l <n> <pdf> -`.
- `createJobQueue(boss: PgBoss, deps): JobQueue & { start(): Promise<void> }` with queues `document-process` (`localConcurrency: 1`, `expireInSeconds: 1800`, `retryLimit: 2`) and `page-process` (`localConcurrency: 2`, `expireInSeconds: 300`, `retryLimit: 3`). The job handlers call `processDocumentVersion(deps: ProcessingDeps, versionId: string): Promise<void>` and `processPage(deps: ProcessingDeps, pageId: string): Promise<void>`, both exported so tests run them without pg-boss; `ProcessingDeps = { db: Db; blobs: BlobStore; jobs: JobQueue }`.
- Document job: set version `processing` → `runOcrmypdf` → put `searchable.pdf` → `pdfInfo` → insert one `pages` row per page (`queued`, displayed dims, `ocr_applied` from the OCR result) → enqueue a page job per page. Page job: thumbnail and `words.json` → page `ready`; on error page `failed` with the message. After each page job, if no pages of the version remain `queued`, set the version `ready`, set `page_count`, and set the document's `current_version_id` to this version (M0 has no re-anchoring). A document job failure after retries sets the version `failed` with `error`.

- [ ] **Step 1: Write the failing core test**

```ts
test('parses poppler bbox xhtml into displayed-space words and lines', () => {
  const xhtml = `<doc><page width="595.3" height="841.9"><block><line xMin="72" yMin="80" xMax="140" yMax="92"><word xMin="72" yMin="80" xMax="100" yMax="92">THE</word><word xMin="104" yMin="80" xMax="140" yMax="92">PIRATES</word></line></block></page></doc>`
  const r = fromPopplerBbox(xhtml)
  expect(r.width).toBeCloseTo(595.3); expect(r.layer.words[0]).toEqual({ t: 'THE', x: 72, y: 841.9 - 92, w: 28, h: 12 }); expect(r.layer.lines).toEqual([[0, 1]])
})
```

- [ ] **Step 2: Write the failing integration tests** (`describe.skipIf(!toolsInstalled())` where `toolsInstalled` checks `ocrmypdf --version`, `pdftoppm -v`, `pdftotext -v`, `qpdf --version`; the skip prints which tool is missing)

```ts
test('text libretto: version ready, pages match pdfinfo, no OCR, page 1 words include PIRATES', ...)
test('synthetic scan: OCR applied, page 1 token overlap with the source text is at least 0.85', ...)    // Jaccard over normalised tokens of page 1 vs the first 48 lines of pirates.txt
test('mixed pdf: page 2 is landscape and ROTATED sits top-left in displayed space; page 4 is OCRd', async () => {
  // pages[1].width > pages[1].height; word 'ROTATED' has y > 0.8 * height and x < 0.25 * width; pages[3].ocrApplied === true
})                                                                                                        // Review Focus 4
test('encrypted pdf: version ready, all pages ocr_applied false, error names exit code 8', async () => {
  // create with: qpdf --encrypt user owner 256 -- libretto.pdf encrypted.pdf
})                                                                                                        // Review Focus 1
```

The integration tests drive the jobs directly (`await processDocumentVersion(deps, versionId)` then `await processPage(deps, pageId)` for each page) rather than through pg-boss, so they are deterministic.

- [ ] **Step 3: Run tests to verify they fail**, **Step 4: Implement**, **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core apps/api/test/processing.test.ts`
Expected: PASS (the scan test takes a minute or so).

- [ ] **Step 6: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(processing): searchable pdf, word layers, thumbnails via pg-boss jobs"
```

---

### Task 13: Core search over word layers

**Files:**
- Create: `packages/core/src/search/normalise.ts`, `packages/core/src/search/search.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/search/search.test.ts`

**Interfaces:**
- Produces: `normaliseToken(s: string): string` (NFKD, strip diacritics, lowercase, strip leading and trailing punctuation, keep inner apostrophes and hyphens); `searchWordLayer(layer: WordLayer, query: string): Hit[]` with `interface Hit { lineIndex: number; wordStart: number; wordEnd: number }` matching the query's normalised tokens as consecutive words within one line; `searchDocument(layers: Map<number, WordLayer>, query: string, limit = 200): DocHit[]` with `interface DocHit extends Hit { pageIndex: number; snippet: string }` where `snippet` is the matched words with up to four words of context each side.

- [ ] **Step 1: Write the failing tests**

```ts
test('matches case-insensitively and ignores punctuation', ...)        // "Frederic," matches 'frederic'
test('matches a phrase across consecutive words in a line', ...)       // 'pirate king'
test('does not match across a line boundary', ...)
test('empty or whitespace query returns nothing', ...)
test('searchDocument orders by page then word and builds snippets', ...)
```

- [ ] **Step 2: Run to verify fail**, **Step 3: Implement**, **Step 4: Run to verify pass** (`pnpm vitest run packages/core`).

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(core): word layer search"
```

---
### Task 14: MCP server with the M0 tools

**Files:**
- Create: `apps/api/src/mcp/server.ts`, `apps/api/src/mcp/auth.ts`, `apps/api/src/mcp/registry.ts`, `apps/api/src/mcp/tools/shows.ts`, `apps/api/src/mcp/tools/documents.ts`, `apps/api/src/mcp/tools/pages.ts`, `apps/api/src/mcp/tools/search.ts`, `apps/api/src/mcp/resources/pages.ts`, `apps/api/src/mcp/resources/guides.ts`, `apps/api/src/services/pages.ts`, `apps/api/src/services/search.ts`, `docs/guides/jayden-style.md`, `docs/guides/mic-and-dca-practice.md`, `docs/guides/tmix-format.md`, `docs/mcp.md`
- Modify: `apps/api/src/app.ts`, `apps/api/src/services/index.ts`
- Test: `apps/api/test/mcp.test.ts`, `apps/api/test/mcpParity.test.ts`

**Interfaces:**
- Consumes: services from Tasks 5, 6, 11, 12; `renderPageImage`; `searchDocument` from core.
- Produces, services: `getPage(db, blobs, actor, { versionId, index }): Promise<{ page: Page; words: WordLayer }>`; `getPageImage(db, blobs, actor, { versionId, index, maxPx }): Promise<{ jpeg: Uint8Array; width: number; height: number }>` (rendered once and cached at `.../pages/{index}/image-1600.jpg`); `searchVersion(db, blobs, actor, { versionId, query, limit }): Promise<DocHit[]>`; `uploadDocumentFromUrl(db, blobs, jobs, actor, { showId, kind, title, url }): Promise<...>` (http or https only, resolves the host and refuses private and loopback ranges, 200 MB cap, 60 s timeout).
- `createMcpServerFactory(deps)` returns a factory for `createMcpHandler` from `@modelcontextprotocol/server`; mounted with `createMcpHonoApp()` at `app.all('/mcp', ...)` behind `mcpAuth`, which validates the bearer PAT via `authenticateToken` and passes `authInfo = { token, clientId: tokenId, scopes: showScope === '*' ? ['shows:*'] : showScope.map(id => 'shows:' + id), expiresAt, extra: { userId } }`; a missing or bad token returns 401 with `WWW-Authenticate: Bearer`.
- Each tool builds `actor = { userId, via: 'mcp', agent }` where `agent` is the client's `name/version` from `getClientVersion()` when available, else the `User-Agent` header, and checks the token scope before the service's own role check.
- Tools (Zod 4 `z.object` input schemas, `structuredContent` plus a text block, annotations set):
  - `list_organisations` (readOnly) → organisations the user belongs to
  - `create_organisation {name}` → organisation
  - `list_shows` (readOnly) → `{ active: ShowSummary[]; archived: ShowSummary[] }`
  - `get_show {showId}` (readOnly) → show with your role and member count
  - `create_show {organisationId?, title}` → show (defaults to the user's first organisation)
  - `update_show {showId, title?, status?, settings?}` → show (owner)
  - `add_show_member {showId, email, role, departments?}` → membership (owner)
  - `list_documents {showId}` (readOnly) → documents with versions and statuses
  - `get_document {documentId}` (readOnly) → document, current version, page summaries (index, width, height, status); also covers `getDocumentVersion`
  - `update_document {documentId, title?, kind?, ocrMode?, snapToText?, sortOrder?}` → document (editor)
  - `upload_document {showId, kind?, title?, documentId?, label?, url, ocrMode?}` → document and version; with `documentId` it adds a version to that document (covers `addDocumentVersion`), otherwise it creates a document. The description tells agents with local files to `curl -F file=@script.pdf -H "Authorization: Bearer $TOKEN" $API/api/shows/$SHOW/documents`
  - `get_page {versionId, index, includeImage?: boolean (default true), maxPx?: number (max 1600)}` (readOnly) → `structuredContent` with dims and the word layer, plus an `image/jpeg` content block
  - `search_script {versionId, query, limit?}` (readOnly) → hits with page index, snippet, and the first word's box
- Resources: `binder://shows/{showId}/versions/{versionId}/pages/{index}/words` (JSON) and `.../image` (JPEG); `binder://guides/{slug}` serving `docs/guides/*.md` with a `list` callback.
- `registry.ts`: `TOOL_NAMES`, `UI_ONLY_OPERATIONS: Record<string, string>` (M0: `createToken`, `listTokens`, `revokeToken`: "token management stays in the UI so an agent cannot mint credentials"; `getShowRole`, `requireShowRole`, `logChange`: "internal helpers"), and `OPERATION_TO_TOOL: Record<string, string>`.
- `docs/guides/*.md` are copies of the three references from `/Users/jayden/theatremix-skills/references/` (`jayden-style.md`, `mic-and-dca-practice.md`, `format.md` renamed `tmix-format.md`) with their frontmatter removed; `docs/mcp.md` documents connecting with Claude Code (`claude mcp add --transport http binder https://<api>/mcp --header "Authorization: Bearer bnd_..."`) and with `mcp-remote` for Claude Desktop.

- [ ] **Step 1: Write the failing parity test**

```ts
test('every service operation is an MCP tool or has a listed exemption', () => {
  const covered = new Set([...Object.keys(OPERATION_TO_TOOL), ...Object.keys(UI_ONLY_OPERATIONS)])
  for (const op of SERVICE_OPERATIONS) expect(covered, `missing MCP coverage for ${op}`).toContain(op)
  for (const op of Object.keys(OPERATION_TO_TOOL)) expect(SERVICE_OPERATIONS).toContain(op)
})
```

- [ ] **Step 2: Write the failing MCP tests** (real client against the Hono app in-process: `new Client(...)` with `StreamableHTTPClientTransport(url, { fetch: (u, i) => app.fetch(new Request(u, { ...i, headers: { ...i?.headers, authorization: 'Bearer ' + token } })) })`)

```ts
test('listTools returns the M0 tools with annotations', ...)
test('a missing bearer token is 401 with WWW-Authenticate', ...)
test('list_shows and get_show respect token show scope', ...)        // token scoped to show A cannot get_show B (forbidden in result, isError true)
test('get_page returns an image block and the word layer for the processed libretto', ...)   // mimeType image/jpeg, structuredContent.words.length > 0
test('search_script finds PIRATES on page 1', ...)
test('create_show via MCP logs via=mcp with the client name as agent', ...)   // change_log row agent matches /test/
test('guides resource lists three guides and reads one', ...)
```

- [ ] **Step 3: Run tests to verify they fail**, **Step 4: Implement services, tools, resources, auth, registry, docs**, **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/api/test/mcp.test.ts apps/api/test/mcpParity.test.ts`
Expected: all PASS.

- [ ] **Step 6: Try it for real**

Run: `claude mcp add --transport http binder-dev http://localhost:3000/mcp --header "Authorization: Bearer <token from the settings page>"` then in Claude Code ask it to list shows and read page 1 of the libretto. Record the transcript summary in `docs/mcp.md` under "Verified clients".

- [ ] **Step 7: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(mcp): streamable http server with show, document, page, search tools and guides"
```

---

### Task 15: Viewer

**Files:**
- Create: `apps/web/src/routes/shows.$showId.tsx` (replace stub), `apps/web/src/routes/shows.$showId.docs.$docId.tsx`, `apps/web/src/documents/DocumentList.tsx`, `apps/web/src/documents/UploadDialog.tsx`, `apps/web/src/blobs/fetchBlob.ts`, `apps/web/src/viewer/usePdfDocument.ts`, `apps/web/src/viewer/renderQueue.ts`, `apps/web/src/viewer/PageCanvas.tsx`, `apps/web/src/viewer/PageList.tsx`, `apps/web/src/viewer/ThumbnailRail.tsx`, `apps/web/src/viewer/ViewerToolbar.tsx`, `apps/web/src/viewer/coords.ts`, `apps/web/src/viewer/pdfjs.ts`
- Test: `apps/web/src/viewer/coords.test.ts`, `apps/web/src/viewer/renderQueue.test.ts`, `apps/web/e2e/viewer.spec.ts`

**Interfaces:**
- Consumes: documents, versions, and pages rows from PowerSync; `/blobs/*`; upload routes.
- Produces: `fetchBlob(url: string): Promise<Response>` cache-first (`caches.open('blobs-v1')`, `match`, else `fetch(url, { credentials: 'include' })` then `put` when 200); `usePdfDocument(url: string | null): { pdf: PDFDocumentProxy | null; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string }` using `getDocument({ data })` with the buffer sliced from the cached response; `pdfjs.ts` sets `GlobalWorkerOptions.workerSrc` from the `?url` import.
- `createRenderQueue(maxConcurrent = 2): { enqueue(key: string, run: () => RenderTask): () => void }` returning a cancel function, unit-tested with fake tasks.
- `PageCanvas({ pdf, pageIndex, zoom, width, height })` renders at `devicePixelRatio` capped at 2, cancels on unmount and on zoom change, calls `page.cleanup()` after eviction. `PageList({ pages, zoom, onVisiblePage })` uses `useVirtualizer` with `estimateSize: i => pages[i].height * zoom + 16`, `overscan: 1`, re-measures on zoom, exposes `scrollToPage(i)` via a ref. `ThumbnailRail` shows `thumb.png` blobs and the current page. `ViewerToolbar`: zoom out, zoom in, fit width, page input, document version label.
- `coords.ts`: `displayedToCss(x: number, y: number, pageHeight: number, zoom: number): { left: number; top: number }` and `cssToDisplayed(left, top, pageHeight, zoom)`.
- `UploadDialog`: file input, kind select, title, posts multipart with `XMLHttpRequest` for progress; the list shows version status live from the synced `document_versions` row (queued, processing, ready, failed with error).

- [ ] **Step 1: Write the failing unit tests**

```ts
test('displayedToCss flips y and scales', () => expect(displayedToCss(72, 841.9 - 92, 841.9, 2)).toEqual({ left: 144, top: 184 }))
test('render queue runs at most 2 at once and cancel removes a pending task', ...)
```

- [ ] **Step 2: Write the failing Playwright test**

```ts
test('upload, process, and view the libretto', async ({ page }) => {
  // as owner: open show, upload fixtures/public/generated/pirates-libretto.pdf, wait for status 'ready' (up to 120s)
  // open viewer: toolbar shows "1 / N" with N > 30; thumbnails visible; type 3 in page input -> page 3 canvas visible and non-blank
})
```

- [ ] **Step 3: Run to verify fail, implement, run to verify pass**

Run: `pnpm vitest run apps/web && pnpm --filter @binder/web e2e --grep viewer`

- [ ] **Step 4: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): document upload and pdf viewer with virtualised pages"
```

---

### Task 16: Search and offline

**Files:**
- Create: `apps/web/src/search/useDocumentSearch.ts`, `apps/web/src/search/SearchPanel.tsx`, `apps/web/src/viewer/PageOverlay.tsx`, `apps/web/src/viewer/SearchHighlights.tsx`, `apps/web/src/offline/prefetch.ts`, `apps/web/src/offline/OfflineButton.tsx`
- Modify: `apps/web/vite.config.ts` (vite-plugin-pwa), `apps/web/src/routes/shows.$showId.tsx`, `apps/web/src/routes/shows.$showId.docs.$docId.tsx`
- Test: `apps/web/src/offline/prefetch.test.ts`, `apps/web/e2e/offline.spec.ts`

**Interfaces:**
- Consumes: `searchDocument` from core; `fetchBlob`; pages rows.
- Produces: `useDocumentSearch(versionId: string): { search(query: string): Promise<DocHit[]>; loading: boolean }` loading every page's `words.json` through `fetchBlob` once and caching in memory; `PageOverlay({ width, height, zoom, children })` renders `<svg viewBox="0 0 W H" style="position:absolute;inset:0;pointer-events:none"><g transform="translate(0 H) scale(1 -1)">{children}</g></svg>` so children draw in displayed coordinates; `SearchHighlights({ hits, words })` draws a `<rect>` per matched word.
- `blobUrlsForShow(rows: { versions: DocumentVersion[]; pages: Page[] }): string[]` pure (searchable PDF, every thumb, every words.json for ready versions), unit-tested; `prefetchShow(db, showId, onProgress): Promise<{ fetched: number; failed: string[] }>`; `OfflineButton` on the show page with progress and a done state, calling `navigator.storage.persist()` first.
- vite-plugin-pwa `generateSW`: `registerType: 'prompt'`, `globPatterns` including the PDF.js worker, `maximumFileSizeToCacheInBytes: 4 * 1024 * 1024`, `navigateFallback: '/index.html'`, `navigateFallbackDenylist: [/^\/api\//, /^\/blobs\//, /^\/mcp/]`, `runtimeCaching`: `/blobs/` CacheFirst into `blobs-v1`, `/api/` NetworkOnly.

- [ ] **Step 1: Write the failing unit test**

```ts
test('blobUrlsForShow lists searchable pdf, thumbs, and words for ready versions only', ...)
```

- [ ] **Step 2: Write the failing Playwright test** (`use.serviceWorkers: 'allow'` for this spec)

```ts
test('make available offline, go offline, view and search', async ({ page, context }) => {
  // click "Make available offline", wait for done; context.setOffline(true); reload; open the libretto; page 1 canvas non-blank
  // search "pirate" -> at least one hit; click the first hit -> the page containing it is scrolled into view and a highlight rect exists
})
```

- [ ] **Step 3: Run to verify fail, implement, run to verify pass**

Run: `pnpm vitest run apps/web && pnpm --filter @binder/web e2e --grep offline`

- [ ] **Step 4: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): search with highlights, offline prefetch, pwa"
```

---

### Task 17: Deployment

**Files:**
- Create: `deploy/Dockerfile.api`, `deploy/Dockerfile.web`, `deploy/Caddyfile`, `deploy/docker-compose.yml`, `deploy/README.md`
- Modify: `.github/workflows/ci.yml` (build both images on push to main), `deploy/powersync/powersync.yaml` (unchanged; env-driven)

**Interfaces:**
- `Dockerfile.api`: `node:24-bookworm-slim`; `apt-get install -y --no-install-recommends ocrmypdf tesseract-ocr tesseract-ocr-eng ghostscript qpdf poppler-utils`; `npm i -g pnpm@12.11.2`; `pnpm install --frozen-lockfile`; `pnpm --filter @binder/api build`; `CMD ["node", "apps/api/dist/server.js"]`; `HEALTHCHECK` on `/api/health`.
- `Dockerfile.web`: build stage runs `pnpm --filter @binder/web build` with `VITE_POWERSYNC_URL` as a build arg; runtime `caddy:2` with `Caddyfile`: `handle /api/* { reverse_proxy api:3000 }`, `handle /blobs/* { reverse_proxy api:3000 }`, `handle /mcp* { reverse_proxy api:3000 }`, `handle { root * /srv; try_files {path} /index.html; file_server }`.
- `docker-compose.yml`: `postgres` (wal_level=logical, volume `pgdata`, init.sql), `powersync` (1.27.0, env from `.env`), `api` (env `DATABASE_URL`, `BLOB_ROOT=/data/blobs`, `POWERSYNC_JWT_SECRET`, `POWERSYNC_URL`, `APP_ORIGIN`, `AUTH_SECRET`, `SMTP_URL`; volume `blobs:/data/blobs`), `web` (port 80). Coolify exposes `web` on `app.<domain>` and `powersync` on `sync.<domain>`.
- `deploy/README.md`: Coolify steps (create a Docker Compose resource from this file, set the env vars listed with how to generate the two secrets with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`, map the two domains, run `docker compose exec api node apps/api/dist/cli.js create-user ...` once), backup commands (`pg_dump` nightly plus the `blobs` volume), and the upgrade procedure (`git pull`, redeploy; migrations run at API start).

- [ ] **Step 1: Validate and build**

Run: `docker compose -f deploy/docker-compose.yml config && docker compose -f deploy/docker-compose.yml build`
Expected: both images build; `docker run --rm binder-api ocrmypdf --version` prints a version.

- [ ] **Step 2: Smoke the full stack locally**

Run: `docker compose -f deploy/docker-compose.yml up -d` then `curl -s localhost/api/health` → `{"ok":true}`, `curl -s localhost:8080/probes/liveness` → 200, open `http://localhost` → login page. Create a user with the CLI, log in, upload the scan fixture, confirm it reaches `ready` inside the container (OCR runs in the image).

- [ ] **Step 3: Deploy to Coolify**

Follow `deploy/README.md`. Confirm from a phone on mobile data: login, open the show, make it available offline, enable flight mode, reload, open the script.

- [ ] **Step 4: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "chore(deploy): dockerfiles, caddy, compose, coolify runbook"
```

---

## Done when

- `pnpm lint && pnpm typecheck && pnpm test` and both Playwright specs pass locally and in CI.
- The stack runs on Coolify; a second user sees the first user's edits within two seconds; a phone in flight mode can open a prefetched script and search it.
- Claude Code connected to `/mcp` with a token can list shows, read a page as an image, and search the script, and the change log shows `via = 'mcp'` for anything it created.
- The spec's section 3.8 carries the sync spike result.
