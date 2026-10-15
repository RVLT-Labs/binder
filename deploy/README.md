# Deploying Binder

Production runs from `deploy/docker-compose.yml` as a Docker Compose application on
[Coolify](https://coolify.io). Four services, all built from this repository (no bind mounts, no
pre-built images to publish):

| Service | Image | Role |
| --- | --- | --- |
| `postgres` | `Dockerfile.postgres` (postgres:17.11) | App database. `wal_level=logical`, `max_slot_wal_keep_size=4GB`; on a fresh volume it creates `powersync_role` and the `powersync_storage` database. Volume `pgdata`. |
| `powersync` | `Dockerfile.powersync` (powersync-service 1.27.0) | Sync service, config baked in. Public at the sync hostname. |
| `api` | `Dockerfile.api` (node 24.21 + ocrmypdf, tesseract, poppler, qpdf, ghostscript) | Hono API, MCP endpoint, and the pg-boss workers that OCR and render uploads. Runs as `node`. Volume `blobs` at `/data/blobs`. |
| `web` | `Dockerfile.web` (caddy 2.11) | The PWA, and a reverse proxy for `/api/*`, `/blobs/*` and `/mcp*` to the API. Public at the app hostname. |

Only `web` and `powersync` are routed publicly. Postgres and the API have no published ports.

## Secrets

Nothing secret is stored in this repository. The compose file asks Coolify to generate them with
its magic variables, and Coolify keeps the same values across redeploys:

| Variable | Used for |
| --- | --- |
| `SERVICE_PASSWORD_POSTGRES` | Postgres superuser `binder`, and the API's `DATABASE_URL` |
| `SERVICE_PASSWORD_POWERSYNC` | `powersync_role` (set once by the init script), and PowerSync's database URIs |
| `SERVICE_BASE64_64_AUTH` | `AUTH_SECRET` (signs sessions) |
| `SERVICE_HEX_64_PSJWT` | The shared secret: the API's `POWERSYNC_JWT_SECRET` and PowerSync's `PS_JWT_SECRET` (64 hex characters is a valid base64url string, and both sides decode it the same way) |

In `NODE_ENV=production` the API refuses to start if `AUTH_SECRET` or `POWERSYNC_JWT_SECRET` is one
of the development values committed in `.env.example` or `docker-compose.dev.yml`.

Do not change `SERVICE_PASSWORD_POSTGRES` or `SERVICE_PASSWORD_POWERSYNC` after the first deploy.
Postgres only applies those passwords when it first creates the data directory, so a changed value
would no longer match the stored one (changing it means `ALTER ROLE` by hand and then updating the
variable). Rotating `SERVICE_BASE64_64_AUTH` signs everyone out; rotating `SERVICE_HEX_64_PSJWT` only
invalidates sync tokens, which clients refetch.

## Deploy on Coolify

Prerequisites: the repository `RVLT-Labs/binder` is connected to Coolify with a deploy key, and
Cloudflare tunnel public hostnames `binder.rvlt.app` and `binder-sync.rvlt.app` both point at
Coolify's Traefik (`http://localhost:80` on the host, or the host's address). Cloudflare terminates
TLS; everything behind it is plain HTTP.

1. In the Coolify project, **Add Resource -> Private Repository (with Deploy Key)**. Pick the
   repository, the branch to deploy, and set the build pack to **Docker Compose**.
2. Base directory `/`. Docker Compose location `/deploy/docker-compose.yml`. Save, and let Coolify
   parse the file.
3. **Domains.** Enter them with an `http://` scheme, because the tunnel terminates TLS and Traefik
   only sees HTTP (an `https://` entry makes Coolify redirect and fight the tunnel):
   - service `web`: `http://binder.rvlt.app`
   - service `powersync`: `http://binder-sync.rvlt.app`
4. **Environment variables.** Set these two (they are required; the deploy fails with a clear message
   if either is missing). Use the public `https://` URLs, because browsers see Cloudflare's TLS:
   - `APP_ORIGIN=https://binder.rvlt.app` (auth cookies, trusted origin, links in emails)
   - `POWERSYNC_URL=https://binder-sync.rvlt.app` (returned to the web app by `/api/sync/token`)

   Optional: `SMTP_URL=smtp://user:pass@host:587` to offer magic-link sign-in. Without it the API
   does not register magic links at all (the endpoint is 404, the login page hides the option, and no
   link is ever written to the log); password sign-in still works. Do not set the `SERVICE_*` secrets by hand; Coolify generates them.
5. **Deploy.** The build takes a few minutes the first time (the API image installs OCR tools).
   Order is enforced by health checks: postgres, then api (it applies the migrations), then powersync and web. Open
   `https://binder.rvlt.app/api/health`: it returns `{"ok":true,"magicLink":false}` (`true` once
   `SMTP_URL` is set).

### First owner

There is no public sign-up. Create the first user from the Coolify terminal of the **api**
container (Resource -> api -> Terminal). Type the password at the prompt so it never lands in shell
history or in this repository:

```sh
read -rsp 'Password (8+ characters): ' BINDER_PASSWORD; echo; export BINDER_PASSWORD
node apps/api/dist/cli.js create-user --email you@example.com --name "Your Name"
unset BINDER_PASSWORD
```

(`BINDER_PASSWORD=... node apps/api/dist/cli.js create-user --email ... --name ...` on one line is
equivalent.) Sign in at `https://binder.rvlt.app`. Each user gets a personal organisation they own.
Other people are added to shows by the show's owner. For Claude Code or another MCP client, create a
personal access token from the same terminal and give it to the client as a bearer token at
`https://binder.rvlt.app/mcp`:

```sh
node apps/api/dist/cli.js create-token --email you@example.com --name "claude code" --scope '*'
```

### Startup order and the PowerSync role

Migration `0003_publication` creates the `powersync` publication and grants `SELECT` on the
published tables to `powersync_role` only if that role already exists. The Postgres init script
(`postgres/init-prod.sh`) creates it when the data directory is first created, and the API waits for
Postgres to be healthy, so on a fresh volume the order is always right.

PowerSync waits for the API to be healthy (as well as Postgres), and the API only reports healthy after
it has applied its migrations, so the publication and the role's grants exist before PowerSync first
connects and no manual restart after the migrations is needed. (Before that dependency was added,
PowerSync could start first; it logged that the publication was missing and retried until the API's
first start created it. If you ever see that, or a stack was brought up some other way, restarting the
`powersync` service is the fallback.)

If the init script failed part way (for example the first start was interrupted), it is safe to
run again: it only creates what is missing and re-applies the role's attributes and password.

```sh
docker compose exec -T postgres sh /docker-entrypoint-initdb.d/10-powersync.sh
# on Coolify, from the host: docker exec <postgres-container> sh /docker-entrypoint-initdb.d/10-powersync.sh
```

If the API had already migrated while the role was missing, the migration is recorded as applied and
will not redo the grants: run `GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;` and
`CREATE PUBLICATION powersync FOR TABLE ...` as in
`packages/db/drizzle/0003_publication.sql` by hand, or recreate the volume.

## Backups

Two things hold state: the Postgres database (`pgdata`) and the uploaded files (`blobs`). The
`powersync_storage` database only caches sync buckets and rebuilds itself from the main database, so
it does not need backing up. Run on the Coolify host (names carry the resource id; find them with
`docker ps --format '{{.Names}}' | grep -E 'postgres|api'` and `docker volume ls | grep blobs`):

```sh
# Database, nightly. Custom format restores with pg_restore.
docker exec <postgres-container> pg_dump -U binder -Fc binder > /backups/binder-$(date +%F).dump

# Uploaded PDFs and derived files.
docker run --rm -v <blobs-volume>:/data:ro -v /backups:/backup alpine \
  tar czf /backup/blobs-$(date +%F).tgz -C /data .
```

Take both from the same moment (database first, then blobs) and keep a few days of each. Put them in
a host cron job or a Coolify scheduled task, and copy them off the host. To restore: bring the stack
up on a fresh volume, **stop the api service** (it holds connections and runs jobs against the
database), run `pg_restore --clean --if-exists -U binder -d binder < dump` inside the postgres
container, untar into the blobs volume, then **start the api service** again. On start it applies any
migrations the dump predates.

## Upgrades

1. Take a database dump (above). Migrations only move forward.
2. Push to the deployed branch and redeploy in Coolify (or enable auto-deploy on push).
3. The API applies pending migrations when it starts, then the web service restarts. Installed
   clients are offered the new version by the service worker and update when the user accepts.

Base images are pinned to a minor version (`postgres:17.11`, `node:24.21-bookworm-slim`,
`caddy:2.11`, `powersync-service:1.27.0`), so a redeploy only picks up patch releases. Bump them on
purpose, in a commit. Moving Postgres to a new major version is not automatic: dump, change the base
image in `Dockerfile.postgres`, restore into a fresh volume.

PowerSync's replication slot keeps WAL until PowerSync has read it. `max_slot_wal_keep_size=4GB` caps
that, so a long PowerSync outage cannot fill the host's disk; past the cap Postgres invalidates the
slot and PowerSync rebuilds its buckets from scratch when it is back (clients resync, nothing is
lost).

## M1 notes (script markup)

**New migrations.** M1 adds migrations `0004` to `0014`: the `departments`, `cues`, `annotations` and
`export_records` tables, the sync chunk ledger, and the change log's `layer` column and batch index.
The API applies them when it starts, as for every upgrade, and each one that adds a synced table extends the `powersync` publication and the
`powersync_role` grant (conditional `DO` blocks, like `0003_publication`). Take the database dump
from [Upgrades](#upgrades) first. After the deploy, `select tablename from pg_publication_tables where
pubname = 'powersync'` should list the four new tables, and `powersync_role` must be able to read them
(a missing grant leaves a table out of sync without an obvious error):

```sql
select t, has_table_privilege('powersync_role', 'public.' || t, 'SELECT') as can_select
from unnest(array['departments', 'cues', 'annotations', 'export_records']) as t;
-- all four rows must say true; or one at a time:
-- SELECT has_table_privilege('powersync_role', 'public.departments', 'SELECT');
```

The PowerSync log should show
`To replicate: "public"."departments"`, `cues`, `annotations` and `export_records`.

**Reverting a revert of a re-anchoring run.** A re-anchoring run moves every cue and annotation it
could place or not place, other members' personal notes included. Reverting the run restores only the
rows the person reverting can see, so other members' personal notes stay where re-anchoring left
them. Those notes surface in their owners' own review list under "On an older version" (or as
unresolved), where each owner can accept, revert or re-anchor them; nothing is lost.

**PowerSync after sync-config changes.** `powersync/sync-config.yaml` is baked into the PowerSync
image, so a change ships with a redeploy. PowerSync reprocesses a changed sync config when it
starts, rebuilding its buckets from the main database, so the first client sync after such a deploy
takes longer than usual; clients keep working from their local data meanwhile and nothing is lost.
PowerSync now starts only once the API is healthy (it depends on the `api` service), so on a normal
deploy the migrations have already run when it first reads the publication and the manual restart that
used to follow them is no longer needed. As a fallback, restart the `powersync` service (Coolify: the
service's Restart; locally `docker compose ... restart powersync`) after any change to the sync config
or to the publication's tables if the PowerSync log still lists the old set of tables, so it re-reads
them. Rows written while it was down are picked up from the replication slot.

**Presence websocket.** Live presence is a WebSocket at `GET /api/shows/<showId>/presence` on the app
hostname. The path is the same as every other API call: Cloudflare tunnel, Coolify's Traefik, then
Caddy's `handle /api/*` reverse proxy to the API. Caddy and Traefik pass the `Upgrade` headers
through, and Cloudflare proxies WebSockets, so no extra configuration is needed; clients send a
frame every five seconds, so idle timeouts along the way never apply. Two guards run before the
upgrade and answer plain HTTP: `403` unless the `Origin` header is exactly `APP_ORIGIN` (which is why
`APP_ORIGIN` must be the public `https://` URL browsers use), then `401` without a session. The
smoke's last step checks both through the proxy (see below). If presence is silent in production
while the rest works, check these two answers first.

### The M1 smoke test

`scripts/m1-smoke.ts` drives a running stack with a `*`-scoped personal access token, over MCP
(client name `m1-smoke`) and REST. It creates a show named `M1 smoke <time>` and archives it at the
end, and also when a step fails (`CLEANUP PASS`/`CLEANUP FAIL` says which), so a run leaves one
read-only show behind. Create the token in the app (Tokens page) or from the api container, and
pass it in the environment only: it is never written to a file or printed.

```sh
# Production: create the token with the First owner commands above, then
printf 'Token: '; read -rs BINDER_TOKEN; echo; export BINDER_TOKEN
BINDER_URL=https://binder.rvlt.app \
  pnpm --filter @binder/api exec tsx ../../deploy/scripts/m1-smoke.ts --stage full
unset BINDER_TOKEN

# Local production stack: BINDER_URL=http://localhost, and
export BINDER_TOKEN=$(docker exec binder-prodtest-api-1 node apps/api/dist/cli.js create-token \
  --email you@example.com --name smoke --scope '*')
```

Run it from the repository root after `pnpm install` (it generates the fixture PDFs on first use,
and the second upload is `fixtures/public/generated/pirates-revised-cut.pdf`). `--stage checkpoint`
runs the first nine steps only (cues, an annotation, renumbering). `--stage full` adds, on the same
show: history shows the cue's insert and relabel as `m1-smoke/1.0.0` via `mcp`; `revert_change`
restores the label; the activity feed lists `<name> via m1-smoke`; the calling script PDF starts
with `%PDF-`; the CSV cue sheet starts with the byte order mark and the XLSX with `PK`; a revised
upload becomes ready and current and `get_reanchor_review` answers; and a presence upgrade without
a session gets `401` (with the app's `Origin`) and `403` (with a foreign one). Every step prints
`PASS` or `FAIL`, and the exit code is non-zero on any failure or if no step ran. The libretto is 147
pages: processing it takes a few minutes, and the script waits up to five minutes for each version.
A laptop that sleeps during the run can trip those waits; run it again.

## Notes

- Uploads are capped at 200 MB by the API, but Cloudflare's proxy caps request bodies at 100 MB on
  Free and Pro plans, so the upload dialog refuses files over 100 MB before sending (and explains a
  proxy 413 the same way). Larger PDFs need a plan with a higher limit and a matching change to
  `MAX_UPLOAD_BYTES` in `apps/web/src/documents/UploadDialog.tsx`.
- Client IPs: see [Client addresses and the rate limiter](#client-addresses-and-the-rate-limiter).
- Caddy is configured for streaming (`flush_interval -1`), which MCP's streamable HTTP needs.
- The API image installs `ocrmypdf` from Debian bookworm (14.x). OCR failures never block a document:
  it falls back to a plain copy with `ocr_applied = false`.
- On SIGTERM the API stops accepting requests, lets in-flight jobs finish for up to 10 seconds, and
  always exits.

## Client addresses and the rate limiter

Better Auth rate-limits sign-in and magic-link requests per client address. The chain is Cloudflare
tunnel (cloudflared, a container on the host), Coolify's Traefik, Caddy (`web`), then the API. The API
reads `CF-Connecting-IP` first and falls back to `X-Forwarded-For`, read from the right past private
proxy addresses. Caddy trusts private ranges, so it passes the forwarded headers on unchanged.

**Why Caddy strips `CF-Connecting-IP`.** Traefik listens on the host's public ports 80 and 443 (Coolify's
default), so anyone can skip Cloudflare and send `Host: binder.rvlt.app` straight to the host's IP.
Such a request can carry any `CF-Connecting-IP`, and a fresh value per request would get a fresh
rate-limit bucket each time, which defeats the limiter (password guessing, magic-link floods). Traefik
appends the address it received each request from to `X-Forwarded-For`, so the last entry is that hop:
a private address for the local cloudflared container, a public one for a direct client. Caddy
removes `CF-Connecting-IP` unless that last entry is private (`@notViaTunnel` in `Caddyfile`); the
API then keys the direct client by its real address from `X-Forwarded-For`.

**Recommended: firewall the host.** The tunnel reaches Traefik locally (`host.docker.internal:80`), so
nothing needs the host's public 80/443. Closing them (host firewall or the provider's firewall, keeping
SSH) removes the bypass entirely; the Caddy rule then stays as a second layer. Docker publishes ports
around `ufw`, so use the provider's firewall or the `DOCKER-USER` iptables chain.

**Post-deploy check.** From a machine outside the host, send sign-in attempts straight to the origin
IP with a different forged `CF-Connecting-IP` each time:

```sh
ORIGIN_IP=203.0.113.10   # the Coolify host's public IP
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "http://$ORIGIN_IP/api/auth/sign-in/email" \
    -H 'Host: binder.rvlt.app' -H 'Origin: https://binder.rvlt.app' -H 'content-type: application/json' \
    -H "CF-Connecting-IP: 198.51.100.$i" -d '{"email":"nobody@example.com","password":"not-the-password"}'
done
```

With the firewall closed every attempt fails to connect (`000`), which is the goal. Without it, the
output must turn into `429` after a few `401`s: the forged header is ignored and the attempts share
your real address's bucket. Six `401`s in a row mean the forged header is being honoured; stop and
check the Caddy rule.

## Trying the production stack locally

Needs Docker. This does not touch the dev stack (`docker-compose.dev.yml`); it uses ports 80 and
18080.

```sh
deploy/scripts/gen-env.sh    # writes a gitignored deploy/.env with fresh random secrets
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml \
  --env-file deploy/.env -p binder-prodtest up -d --build
deploy/scripts/prod-smoke.sh # health, web, sync, OCR upload, MCP; prints PASS
docker compose -p binder-prodtest down -v
```

The M1 smoke ([The M1 smoke test](#the-m1-smoke-test)) runs against it with `BINDER_URL=http://localhost`.
`gen-env.sh` refuses to overwrite an existing `deploy/.env`; pass `--force`, or delete the file, to
get fresh secrets. Remove the generated file when you are done.

## Scheduled backups (configured in Coolify)

Two Coolify scheduled tasks run in the `postgres` container:

| Task | Schedule | Command |
|---|---|---|
| binder-db-nightly | `15 3 * * *` | `sh -c 'pg_dump -U binder -Fc binder > /backups/binder-$(date +%u).dump'` (7 rotating daily dumps) |
| binder-blobs-weekly | `45 3 * * 0` | `sh -c 'tar -czf /backups/blobs-$(( $(date +%V) % 4 )).tgz -C /blobs .'` (4 rotating weekly archives) |

Both write to the `backups` volume on the same host. Copy that volume off-host (for example a nightly rsync or rclone from the host) for disaster recovery. Restore: stop `api`, `pg_restore -U binder -d binder --clean /backups/binder-N.dump`, extract the blobs archive into the `blobs` volume, start `api`.
