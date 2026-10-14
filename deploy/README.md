# Deploying Binder

Production runs from `deploy/docker-compose.yml` as a Docker Compose application on
[Coolify](https://coolify.io). Four services, all built from this repository (no bind mounts, no
pre-built images to publish):

| Service | Image | Role |
| --- | --- | --- |
| `postgres` | `Dockerfile.postgres` (postgres:17) | App database. `wal_level=logical`; on a fresh volume it creates `powersync_role` and the `powersync_storage` database. Volume `pgdata`. |
| `powersync` | `Dockerfile.powersync` (powersync-service 1.27.0) | Sync service, config baked in. Public at the sync hostname. |
| `api` | `Dockerfile.api` (node 24 + ocrmypdf, tesseract, poppler, qpdf, ghostscript) | Hono API, MCP endpoint, and the pg-boss workers that OCR and render uploads. Runs as `node`. Volume `blobs` at `/data/blobs`. |
| `web` | `Dockerfile.web` (caddy 2) | The PWA, and a reverse proxy for `/api/*`, `/blobs/*` and `/mcp*` to the API. Public at the app hostname. |

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

   Optional: `SMTP_URL=smtp://user:pass@host:587` so magic-link emails are sent; without it they are
   only logged. Do not set the `SERVICE_*` secrets by hand; Coolify generates them.
5. **Deploy.** The build takes a few minutes the first time (the API image installs OCR tools).
   Order is enforced by health checks: postgres, then powersync and api, then web. Open
   `https://binder.rvlt.app/api/health`: it returns `{"ok":true}`.

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

### The role must exist before the API first starts

Migration `0003_publication` creates the `powersync` publication and grants `SELECT` on the
published tables to `powersync_role` only if that role already exists. The Postgres init script
(`postgres/init-prod.sh`) creates it when the data directory is first created, and the API waits for
Postgres to be healthy, so on a fresh volume the order is always right. If you ever bring up an API
against a database that was created without the role, create it, then re-run that migration's
statements by hand (or recreate the volume), or PowerSync will not see the tables.

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
up on a fresh volume, `pg_restore --clean --if-exists -U binder -d binder < dump` into the postgres
container, and untar into the blobs volume.

## Upgrades

1. Take a database dump (above). Migrations only move forward.
2. Push to the deployed branch and redeploy in Coolify (or enable auto-deploy on push).
3. The API applies pending migrations when it starts, then the web service restarts. Installed
   clients are offered the new version by the service worker and update when the user accepts.

Moving Postgres to a new major version is not automatic: dump, change the base image in
`Dockerfile.postgres`, restore into a fresh volume.

## Notes

- Uploads are capped at 200 MB by the API, but Cloudflare's proxy caps request bodies at 100 MB on
  Free and Pro plans. Larger PDFs need a plan with a higher limit.
- Caddy is configured for streaming (`flush_interval -1`), which MCP's streamable HTTP needs.
- The API image installs `ocrmypdf` from Debian bookworm (14.x). OCR failures never block a document:
  it falls back to a plain copy with `ocr_applied = false`.
- On SIGTERM the API stops accepting requests, lets in-flight jobs finish for up to 10 seconds, and
  always exits.

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
