# Final whole-branch review: M0 Foundation (0f6f854..f704e6f)

Reviewer: Opus, read-only. The filtered package (`review-final-m0-filtered.diff`, about 665 KB and 17,880 lines) is large. I used its commit list and stat to find every changed file. The checkout was clean at HEAD = f704e6f, so I read the changed source files at HEAD, which have the same content as the diff, area by area: API core and auth, services, sync, MCP, processing, web client, then deploy and CI. I also read the spec, the plan's task contracts, and every ruling and deferred line in the ledger. To check the sign-up guard I read the code in the installed Better Auth 1.7.7, better-call and rou3 packages, and I ran a small Node script to check `BlockList` handling of IPv4-mapped addresses. I did not start any servers or containers.

## Strengths

- **One permission gate that really holds.** Every show-scoped read and write goes through `requireShowRole` with the actor's token scope (R27). That covers REST, sync (through `updateShow` and `updateDocument`), MCP tools and resources, blobs, and search. Nothing outside `services/tenancy.ts` reads `show_memberships` for authorisation, except token creation, which checks membership on purpose. Non-members get a 404 that hides whether the show exists.
- **The service layer is the single write path.** Sync apply calls services inside nested savepoints. MCP tools and REST routes are thin adapters. The parity test enumerates the service barrel, and `mcp.test.ts` checks that the registered tools equal `TOOL_NAMES`, so the parity rule is enforced in both directions.
- **The sync write path resists wedging.** Each entry is validated with Zod, including SQLite encodings, a recursive NUL check and bounded `clientTs`. Rejections come back in a 200 response, and a 503 rolls back the whole batch. Tests cover a revoked membership mid-queue, archived shows, token scope and a mid-batch failure.
- **Uploads are careful.** Authorisation runs before the body is read. The 200 MB limit is enforced on the bytes actually received. The magic-byte check comes before any storage. The blob is removed if the row transaction fails. Concurrent version numbers are serialised with `FOR UPDATE`.
- **The SSRF guard is real.** The connect-time DNS check closes the rebinding window, literal IPs and redirects are re-checked, and Node's `BlockList` covers IPv4-mapped IPv6 (I verified this). Decimal, octal and `0` hosts are normalised by `URL` before the check.
- **Processing is idempotent.** Page rows are upserted on retry, expiry is derived from the OCR timeout (R46), dead-letter queues mean nothing stays `processing` (R45), and `finishVersionIfDone` uses a single conditional UPDATE.
- **The web client handles ownership carefully.** The local database is claimed before anything renders, foreign data is wiped on a shared device (R36), sign-out runs server-first and then clears data, and the schema parity test pins the client columns to Drizzle (R37).
- **Deploy hygiene is good.** Secrets come from Coolify magic variables, the API refuses the dev secrets in production, `init-prod.sh` is idempotent and quotes with `%L`, the healthcheck uses `-h localhost`, shutdown always exits, and the README covers startup ordering and restore.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

**I1. Cookie-authenticated POST routes have no CSRF or Origin check, and the cookie is sent same-site from every `*.rvlt.app` host.**
`apps/api/src/app.ts:64-79`, `apps/api/src/auth/middleware.ts:15-29`, `apps/api/src/routes/{tenancy,sync,documents,tokens}.ts`.
- **What is wrong:** Better Auth checks `trustedOrigins` only for its own `/api/auth/*` endpoints. Binder's routes rely on the session cookie alone. That cookie is `SameSite=Lax` (Better Auth's default, confirmed in `better-auth/dist/cookies/index.mjs`). Lax blocks cross-site POSTs, but `flow.rvlt.app` and any other `*.rvlt.app` host are the same site as `binder.rvlt.app`.
- **How it can be used:** `c.req.json()` parses the body whatever its content type. A page on a sibling subdomain can therefore send a "simple" request (`text/plain` JSON, or `multipart/form-data` built in JavaScript with `fetch(..., {mode: 'no-cors', credentials: 'include'})`) that carries the victim's cookie, to:
  - `POST /api/shows/:id/members` with `{email: attacker, role: 'owner'}`, which takes over a show;
  - `POST /api/sync/upload`, which renames or archives shows;
  - `POST /api/orgs/:id/shows`, or a document upload.
- **Why it matters:** an XSS or any user-controlled content on another RVLT app becomes owner-level access to show material. The precondition (a foothold on a sibling host) is real for a domain that hosts several apps.
- **Fix:** in the session branch of `requireSession` and `requireUser`, reject unsafe methods unless `Origin` equals `APP_ORIGIN`, or `Sec-Fetch-Site` is `same-origin`. Bearer requests have no cookie and are unaffected. Also require `Content-Type: application/json` on the JSON routes. Add a test that a POST with `Origin: https://evil.rvlt.app` gets a 403.

**I2. The rate limiter trusts `CF-Connecting-IP`, which any client can forge if it reaches the origin's Traefik directly.**
`apps/api/src/auth/auth.ts:25-36`, `deploy/Caddyfile:10-12`, README Notes.
- **What is wrong:** the README's safety condition reads "only reachable through those proxies; do not publish the api or web ports". But Traefik itself listens on the host's public ports 80/443 (Coolify's default). The tunnel targets `host.docker.internal:80`, and the domains are configured as `http://`.
- **How it can be used:** a request sent straight to the host's public IP on port 80, with `Host: binder.rvlt.app` and a random `CF-Connecting-IP` each time, lands in a fresh rate-limit bucket on every request. Better Auth's `getIP` takes the first configured header that parses (I verified this in `@better-auth/core/dist/utils/ip.mjs`).
- **Why it matters:** password guessing against the owner account and magic-link floods are no longer rate-limited, which defeats the last fix round.
- **Fix:** before relying on the header, firewall the host so 80/443 accept only Cloudflare ranges, or bind the proxy to localhost because the tunnel is local. Alternatively, have Cloudflare add a secret header, have Caddy strip `CF-Connecting-IP` when that header is absent, and drop `cf-connecting-ip` from `ipAddressHeaders`. Then correct the README sentence so it names the real condition.

**I3. In production without `SMTP_URL`, every magic link (a five-minute login credential) is written to the container log, and the UI says "Sign-in link sent".**
`apps/api/src/auth/mailer.ts:14-18`, `deploy/docker-compose.yml:65`, `apps/web/src/routes/login.tsx:31-42`.
- **What is wrong:** anyone on the internet can trigger link generation for any email, and Better Auth generates the token before it checks whether the user exists. Because of I2 this is not reliably rate-limited, so logs fill with live credentials. A real user is told an email was sent when nothing was.
- **Why it matters:** logs become a credential store, and the UI misleads the user.
- **Fix:** when `NODE_ENV=production` and `SMTP_URL` is unset, register the `magicLink` plugin only if SMTP is configured, or make the log mailer print only a "magic link requested, SMTP not configured" line without the URL. Then hide the button (expose a `magicLink` flag from `/api/health` or `/api/me`) or show an honest error.

**I4. The sync change-log `batch_id` is the client's local `transactionId`, a small per-device counter, so ids collide permanently in the append-only log.**
`apps/web/src/powersync/connector.ts:58`, `apps/api/src/routes/sync.ts:23,54`.
- **What is wrong:** PowerSync's `transactionId` is the local `ps_crud` transaction counter, which restarts after `disconnectAndClear` (sign-out, or a foreign wipe). Every device, and every user, sends `"1"`, `"2"` and so on.
- **Why it matters:** spec 4.12 defines the batch id as "one sync upload or one MCP call", and the M1 activity feed groups by batch and user. The same user on two devices, or the same device after signing in again, produces merged batches. The rows written in production now cannot be fixed later. This is the ledger's deferred line "batchId = per-device transactionId can collide", which is more consequential than its grading because the data is permanent.
- **Fix:** the server mints `batchId = newId()` per upload request and ignores or records the client value (a one-line change in `routes/sync.ts`). Alternatively the client sends `newId()`. Do this before the first production write.

**I5. No backups are scheduled for the first production deploy.**
`deploy/README.md:109-130`. Spec 3.7 requires a nightly Postgres dump plus the blob volume. The README gives the commands but leaves scheduling to "a host cron job or a Coolify scheduled task". Real show material will be uploaded right after deploy, and the pgdata and blobs volumes have no copy anywhere. This is operational rather than code. Before the first real upload, set up a Coolify scheduled task (or host cron) that runs the documented commands with an off-host copy, and do one test restore into a scratch stack.

### Minor (Nice to Have)

1. **The client never sends `clientTs`, so `change_log.client_ts` is always null for sync writes.** `apps/web/src/powersync/connector.ts:27-34`. The server validates the field (R34), but `toCrudEntries` never sets it. Spec 4.12 records "client timestamp (when the edit was made, which may be offline)". Use PowerSync's tracked metadata, or a column, to carry the edit time.
2. **The same concepts are implemented more than once.**
   - The token scope check exists three times: inline in `requireShowRole` (`services/tenancy.ts:66`), inline in `listShows` (`:172`), and as `tokenAllowsShow` (`services/tokens.ts:116`), which is now dead code used only by tests and listed as an MCP exemption.
   - Bearer authentication exists twice: `auth/bearer.ts` and `mcp/auth.ts` each do the regex, `authenticateToken`, a user lookup and the actor or `AuthInfo` setup.
   - Fix: make `requireShowRole` and `listShows` call `tokenAllowsShow`, and share one `resolveBearer()` helper.
3. **Validation differs across the three clients.** The sync path rejects NUL in `title` and `settings` (R11). `PATCH /api/shows/:id` (`routes/tenancy.ts:20-24`), the MCP `update_show` tool, and `update_document` do not, so Postgres raises an error and the client gets a 500 (`internal`) instead of a 400. Share the column schemas from `sync/policy.ts`.
4. **The upload limit says 200 MB, but Cloudflare stops bodies at 100 MB.** `UploadDialog.tsx:3,46` and `serverMessage` turn this into the opaque "Upload failed (413)." Either show "Files over 100 MB cannot be uploaded through the current proxy" on a 413 with a non-JSON body, or make the client limit configurable.
5. **Membership cannot be removed or changed anywhere (UI, REST or MCP), and `add_show_member` can grant `owner` with no confirmation gate.** A wrong grant can only be undone with SQL. Spec 3.10's confirmation gate covers operations that are hard to reverse; an owner grant via an agent is one. Add `removeShowMember` and `updateShowMember` (owner-only, logged) with an MCP confirmation in M1 at the latest.
6. **A version can be orphaned in `queued`.** `services/documents.ts:207,291` enqueues after the commit, so a crash between the two leaves a version queued forever with no job and no sweeper. Use pg-boss's transactional send (the `db` option) inside the row transaction, or sweep queued versions with no job at startup.
7. **The page job turns transient tool failures into permanent `failed` pages.** `processing/pageJob.ts:113-119` catches everything, so pg-boss never retries (spec 3.6: "retried three times"), and M0 has no retry action. This was deferred in the ledger and is restated here because there is no recovery path except re-uploading. Rethrow `ToolError` with `exitCode === null` (timeout, spawn failure) and I/O errors, and mark only deterministic failures as failed.
8. **There are no browser security headers.** `deploy/Caddyfile` sets no CSP, `frame-ancestors` or `X-Frame-Options`, so the tokens page can be framed. Uploaded PDFs are served inline on the app origin (`routes/blobs.ts:35`). Add `Content-Security-Policy: frame-ancestors 'self'` app-wide and `Content-Security-Policy: sandbox` on `/blobs/*`.
9. **WAL growth is unbounded if PowerSync is down.** `Dockerfile.postgres` does not set `max_slot_wal_keep_size`. While PowerSync is stopped or broken, its slot holds WAL and pg-boss keeps writing, which can fill the host disk that it shares with other apps. Set a cap (for example `-c max_slot_wal_keep_size=4GB`). PowerSync resyncs if the slot is invalidated.
10. **Base images use floating tags:** `caddy:2`, `postgres:17` and `node:24-bookworm-slim`. A redeploy can pick up a behaviour change without any commit. Pin minor versions (or digests) as `powersync-service:1.27.0` already is.
11. **The processing suites can pass vacuously.** `processing.test.ts` and the MCP "processed pages" suite use `describe.skipIf(missing.length > 0)`, so CI goes green without exercising processing if a tool is missing. Make the skip throw when `process.env.CI` is set.
12. **How Coolify resolves the build contexts is unverified.** `deploy/docker-compose.yml` uses `context: .` and `context: ..`, which assumes paths resolve from `deploy/`. The local smoke ran `docker compose -f deploy/docker-compose.yml`, so the project directory defaulted to `deploy/`. If Coolify passes `--project-directory <base dir>`, relative paths resolve from the repository root and the build fails. The failure would be loud and safe. The Coolify docs I checked do not settle the question. If it fails, set Base Directory to `/deploy` and the compose location to `/docker-compose.yml`.
13. **JSON bodies have no size limit**, including the unauthenticated `/api/auth/*`. Only Cloudflare's 100 MB limit applies. Add `request_body { max_size 2MB }` for the JSON paths in Caddy, or Hono's `bodyLimit` on the non-upload routes.
14. **Any user can discover which emails have accounts.** Every user owns their own shows, and `addShowMember` returns "No user with that email" (`services/tenancy.ts:266`). The user base is small and the impact is low.
15. **The client has no PWA manifest.** `vite.config.ts:80` (`manifest: false`) means it is not installable, while spec 3.1 says "installable PWA" and iPad is a target. This is a plan gap.

### Issues with the plan rather than the implementation

- **Search scope.** Spec 5.2 says search "runs over the cached word layers for every document in the show". The plan's Task 16 defines `useDocumentSearch(versionId)` for one version, and the code follows the plan.
- **Retry actions.** Spec 5.1 ("surfaces a retry action" on OCR fallback) and spec 8 ("a retry action re-queues the page") are in no M0 task. Combined with Minor 7, failed pages cannot be recovered.
- **Extraction tool.** Spec 5.1 names pdfjs-dist for dimensions and word extraction. The plan chose poppler. The behaviour is equivalent (displayed space, R38), but the spec text is now stale.

## Deferred-minor triage

Ledger lines I would fix, or verify, before production:

- **Task 9: "batchId = per-device transactionId can collide across devices (grouping only, not idempotency)".** Fix now; this is I4. The change log is append-only, so ids written in production are permanent, and spec 4.12 defines the batch id as one upload.
- **Task 9: "provider claim IIFE has no try/catch; a throw renders null forever (fail-closed blank screen)".** Fix now; it is cheap. Any local database initialisation failure leaves a blank page with no message: OPFS unavailable (Firefox private windows, some managed browsers), a quota error, or a worker load failure through the service worker. A booth laptop or iPad user then has nothing to report. Catch the error and render "This browser could not open Binder's local storage: …".
- **Task 17 note: "CF-Connecting-IP trusted — safe only while the API is reachable solely via Cloudflare/Traefik/Caddy".** Fix or verify; this is I2. The stated condition is probably false by default on a Coolify host.
- **Task 4 note: "cookie Secure flag derives from baseURL protocol; verify in T17 deployment smoke over https"** and **Task 14: "production Host guard (APP_ORIGIN host) untested".** No code change, but both are **must-verify in the post-deploy smoke at `https://binder.rvlt.app`**. Check that sign-in sets a `__Secure-` cookie and that it survives a reload, and that an MCP `initialize` with a token returns 200 rather than 403. The local smoke ran over `http://localhost`, so it proved neither.

None of the other deferred minors needs to be fixed before production. I re-checked "sign-up guard compares c.req.path exactly" against better-call 1.4.0 and rou3 0.9.2. Trailing-slash, double-slash, case-variant and percent-encoded paths all return 404 inside Better Auth, so no bypass exists today. `emailAndPassword.disableSignUp` would still be a sturdier second layer.

## Declined to judge

- **Large PDFs in memory:** the viewer loads the whole searchable PDF into one ArrayBuffer (no Range requests, accepted in T11), which may be heavy for a 200 MB scan on an iPad. This is a design choice; it needs a measurement, not a review.
- **Container resources:** the API container has no CPU or memory limits while OCR (`--jobs 2`) runs on a host shared with RVLT Flow. Capacity planning is outside the spec.
- **Archived shows are synced by default**, against spec 3.3. This was deferred to M2 by the comment in `sync-config.yaml`, so it is outside M0.
- **No document delete or show delete operations.** Spec 4.1 lists document delete, but no M0 task includes it.
- **REST bearer requests are logged as `via: 'mcp'`** with the User-Agent as `agent`. The spec's `via` enum has no `api` value; this is a spec choice.
- **HSTS and TLS settings** are terminated at Cloudflare and are outside the repository.
- **Restore when PowerSync's replication slot sees dropped and recreated tables** after `pg_restore --clean`. That is PowerSync operational behaviour I cannot check without running it; the README covers stopping the API but not resyncing PowerSync.
- **Better Auth session lifetime defaults** (7 days, refreshed on use). Accepted library behaviour.
- **Per-page OCR and processing performance** (147 pages in about 2.5 minutes). Already deferred as a performance follow-up.
- **Accessibility details in the viewer** (focus ring, keyboard paging). Already deferred, and not a production-safety concern.

## Recommendations

1. Before deploying, fix I1 (Origin check on cookie-authenticated unsafe methods), I3 (no magic links in logs, and an honest UI) and I4 (server-minted batch id), plus the blank-screen catch. Each is a few lines with a test.
2. At deploy time, close or verify I2 (host firewall, or the strip-header approach), set up I5 (scheduled backups plus one test restore), and run the post-deploy smoke at the public hostnames: Secure cookie, MCP Host guard, sync stream, an upload under 100 MB, and an attempted sign-up returning 403.
3. In the first M1 fix-up: Minor 2 (one scope helper, one bearer resolver), Minor 3 (shared validators), Minor 5 (member removal and a confirmation gate), Minor 6 and 7 (transactional enqueue and retrying transient page failures), Minor 9 (WAL cap) and Minor 10 (CI must not skip processing).
4. Update the spec addendum for the search scope, the retry action and the extraction tool, so the plan and spec agree again.

## Assessment

**Ready to merge?** With fixes

**Reasoning:** No critical defects. The single permission gate, the sync write path, uploads and processing are sound and well tested across every client. Five issues should be fixed or verified before real show data goes in, and none needs redesign: the CSRF gap from sibling `rvlt.app` hosts, the spoofable rate-limit IP, magic links written to the log without SMTP, the permanent `batch_id` collisions, and the lack of scheduled backups.
