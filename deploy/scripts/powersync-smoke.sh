#!/usr/bin/env bash
# End-to-end smoke test for the dev PowerSync stack. Prints PASS or FAIL.
#
# Prerequisites: Docker running, and the API running against the dev database, e.g.
#   set -a; . ./.env; set +a; pnpm --filter @binder/api dev
#
# What it does:
#   1. brings up deploy/docker-compose.dev.yml (a no-op if already up) and waits for PowerSync
#   2. creates a throwaway user with the CLI (password via BINDER_PASSWORD) and signs in over HTTP
#   3. creates an organisation and a show for that user over HTTP
#   4. fetches GET /api/sync/token with the session cookie
#   5. streams from PowerSync and expects HTTP 200 and the new show to arrive (replication works)
#   6. checks a bearer personal access token is refused at /api/sync/token, and that the CLI's
#      `create-token` command works against the live database
# The compose stack is left running afterwards; stop it with
#   docker compose -f deploy/docker-compose.dev.yml down        (add -v to wipe data)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/docker-compose.dev.yml")

# Dev defaults, the same as .env.example; anything already exported wins.
: "${DATABASE_URL:=postgres://binder:binder@localhost:5432/binder}"
: "${BLOB_ROOT:=$ROOT/.data/blobs}"
: "${APP_ORIGIN:=http://localhost:5173}"
: "${AUTH_SECRET:=dev-only-auth-secret-change-me-0123456789}"
: "${POWERSYNC_JWT_SECRET:=YmluZGVyLWRldi1wb3dlcnN5bmMtc2VjcmV0LTMyYnk}"
: "${POWERSYNC_URL:=http://localhost:8080}"
: "${API_URL:=http://localhost:3000}"
export DATABASE_URL BLOB_ROOT APP_ORIGIN AUTH_SECRET POWERSYNC_JWT_SECRET POWERSYNC_URL

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; echo FAIL; exit 1; }
step() { echo "==> $*"; }
json() { node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],o);if(v===undefined)process.exit(1);console.log(v)' "$1"; }

step "starting the dev stack"
"${COMPOSE[@]}" up -d >/dev/null

step "waiting for PowerSync liveness"
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$POWERSYNC_URL/probes/liveness" || true)" = 200 ] && break
  sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$POWERSYNC_URL/probes/liveness" || true)" = 200 ] \
  || fail "PowerSync liveness never returned 200 (docker compose logs powersync)"

curl -fsS "$API_URL/api/health" >/dev/null 2>&1 \
  || fail "API is not reachable at $API_URL (start it: set -a; . ./.env; set +a; pnpm --filter @binder/api dev)"

STAMP="$(date +%s)-$RANDOM"
EMAIL="smoke-$STAMP@binder.test"
BINDER_PASSWORD="$(openssl rand -hex 16)"
export BINDER_PASSWORD
CLI=(pnpm --silent --filter @binder/api exec tsx src/cli.ts)

step "creating throwaway user $EMAIL"
(cd "$ROOT" && "${CLI[@]}" create-user --email "$EMAIL" --name "Smoke $STAMP") >"$WORK/user-id" \
  || fail "create-user failed"

step "signing in"
curl -fsS -c "$WORK/jar" -H "Origin: $APP_ORIGIN" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$BINDER_PASSWORD\"}" \
  "$API_URL/api/auth/sign-in/email" >/dev/null || fail "sign-in failed"

step "creating an organisation and a show"
SHOW_TITLE="Smoke Show $STAMP"
ORG_ID="$(curl -fsS -b "$WORK/jar" -H 'content-type: application/json' -d '{"name":"Smoke Org"}' \
  "$API_URL/api/orgs" | json organisation.id)" || fail "create organisation failed"
curl -fsS -b "$WORK/jar" -H 'content-type: application/json' -d "{\"title\":\"$SHOW_TITLE\"}" \
  "$API_URL/api/orgs/$ORG_ID/shows" >/dev/null || fail "create show failed"

step "fetching a sync token"
curl -fsS -b "$WORK/jar" "$API_URL/api/sync/token" >"$WORK/token.json" || fail "GET /api/sync/token failed"
TOKEN="$(json token <"$WORK/token.json")"
ENDPOINT="$(json endpoint <"$WORK/token.json")"
echo "    endpoint $ENDPOINT, expires $(json expiresAt <"$WORK/token.json")"

step "streaming from PowerSync (up to 20s for the show to replicate)"
# The stream never ends on its own; curl exits 28 at --max-time, which is expected here.
curl -sN --max-time 20 -D "$WORK/headers" -o "$WORK/stream" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$ENDPOINT/sync/stream" -d '{}' || true
STATUS="$(head -n1 "$WORK/headers" | awk '{print $2}')"
LINES="$(wc -l <"$WORK/stream" | tr -d ' ')"
echo "    HTTP $STATUS, $LINES line(s) streamed"
[ "$STATUS" = 200 ] || fail "PowerSync returned HTTP $STATUS: $(head -c 300 "$WORK/stream")"
[ "$LINES" -ge 1 ] || fail "no output from the sync stream"
grep -q "$SHOW_TITLE" "$WORK/stream" \
  || fail "the show did not arrive in the sync stream (replication problem; docker compose logs powersync)"

step "a bearer token must not mint a sync token"
PAT="$(cd "$ROOT" && "${CLI[@]}" create-token --email "$EMAIL" --name smoke --scope '*')" \
  || fail "create-token failed against the live database"
case "$PAT" in bnd_*) echo "    create-token: succeeded" ;; *) fail "create-token printed an unexpected value" ;; esac
CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $PAT" "$API_URL/api/sync/token")"
[ "$CODE" = 401 ] || fail "bearer token got HTTP $CODE from /api/sync/token, expected 401"

echo PASS
