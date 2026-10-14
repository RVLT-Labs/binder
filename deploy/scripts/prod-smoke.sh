#!/usr/bin/env bash
# Smoke test for the production compose stack running locally. Prints PASS or FAIL.
#
#   deploy/scripts/gen-env.sh
#   docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml \
#     --env-file deploy/.env -p binder-prodtest up -d --build
#   deploy/scripts/prod-smoke.sh
#   docker compose -p binder-prodtest down -v
#
# Checks: the API through Caddy, PowerSync liveness, the web app and its caching headers, a user created
# with the CLI inside the api container, sign-in over HTTP, a sync token and a replicated show seen
# through PowerSync, a scanned PDF uploaded and OCR'd inside the container, and the MCP endpoint with
# a personal access token. Passwords and tokens are generated here and never printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="${PROJECT:-binder-prodtest}"
DC=(docker compose -f "$ROOT/deploy/docker-compose.yml" -f "$ROOT/deploy/docker-compose.local.yml"
  --env-file "$ROOT/deploy/.env" -p "$PROJECT")
WEB="${WEB_URL:-http://localhost}"
SYNC="${SYNC_URL:-http://localhost:18080}"
SCAN_PDF="$ROOT/fixtures/public/generated/pirates-scan.pdf"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; echo FAIL; exit 1; }
step() { echo "==> $*"; }
ok() { echo "    ok: $*"; }
json() { node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],o);if(v===undefined)process.exit(1);console.log(v)' "$1"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@" || true; }
header() { curl -sI "$2" | tr -d '\r' | grep -i "^$1:" | head -1 | cut -d' ' -f2- ; }

[ -f "$SCAN_PDF" ] || (cd "$ROOT" && pnpm fixtures >/dev/null) || fail "could not generate fixtures"

step "API health through the web proxy"
HEALTH="$(curl -s "$WEB/api/health")"
[ "$(printf '%s' "$HEALTH" | json ok)" = true ] || fail "GET $WEB/api/health did not return ok: $HEALTH"
ok "$HEALTH"

step "magic links only with SMTP (never written to the log)"
if [ "$(printf '%s' "$HEALTH" | json magicLink)" = false ]; then
  [ "$(status -H "Origin: $WEB" -H 'content-type: application/json' -d '{"email":"nobody@binder.test"}' \
    "$WEB/api/auth/sign-in/magic-link")" = 404 ] || fail "magicLink is false but the magic-link endpoint answers"
  ok "SMTP not configured: magicLink false and the endpoint is 404"
else
  ok "SMTP configured: magicLink true"
fi

step "PowerSync liveness"
[ "$(status "$SYNC/probes/liveness")" = 200 ] || fail "$SYNC/probes/liveness is not 200"
ok "200"

step "web app and caching"
curl -s "$WEB/" | grep -q '<div id="root">' || fail "GET / is not the app's index.html"
curl -s "$WEB/shows/anything/deep/link" | grep -q '<div id="root">' || fail "SPA fallback does not serve index.html"
[ "$(header cache-control "$WEB/")" = "no-cache" ] || fail "index.html is not no-cache"
[ "$(status "$WEB/sw.js")" = 200 ] || fail "sw.js missing"
[ "$(header cache-control "$WEB/sw.js")" = "no-cache" ] || fail "sw.js is not no-cache"
ASSET="$(curl -s "$WEB/" | grep -oE '/assets/[^"]+\.js' | head -1)"
[ -n "$ASSET" ] || fail "no hashed asset referenced from index.html"
case "$(header cache-control "$WEB$ASSET")" in *immutable*) ;; *) fail "$ASSET is not immutable" ;; esac
[ "$(status "$WEB/assets/missing.js")" = 404 ] || fail "a missing hashed asset must 404, not fall back to index.html"
PDFJS="$(cd "$ROOT/apps/web" && ls dist/pdfjs/wasm 2>/dev/null | head -1 || true)"
[ -z "$PDFJS" ] || [ "$(status "$WEB/pdfjs/wasm/$PDFJS")" = 200 ] || fail "/pdfjs/wasm/$PDFJS is not served"
ok "index.html, SPA fallback, sw.js no-cache; /assets immutable and 404 when missing; /pdfjs served"

step "security headers"
[ "$(header content-security-policy "$WEB/")" = "frame-ancestors 'self'" ] || fail "index.html lacks CSP frame-ancestors 'self'"
[ "$(header x-frame-options "$WEB/")" = SAMEORIGIN ] || fail "index.html lacks X-Frame-Options SAMEORIGIN"
[ "$(header x-content-type-options "$WEB/")" = nosniff ] || fail "index.html lacks X-Content-Type-Options nosniff"
[ "$(header referrer-policy "$WEB/")" = strict-origin-when-cross-origin ] || fail "index.html lacks Referrer-Policy"
[ "$(header content-security-policy "$WEB/api/health")" = "frame-ancestors 'self'" ] || fail "API responses lack CSP frame-ancestors"
WORKER="$("${DC[@]}" exec -T web ls /srv/assets | grep -E '^pdf\.worker.*\.m?js$' | head -1 || true)"
[ -n "$WORKER" ] || fail "no pdf.worker script in the web image's /srv/assets"
case "$(header content-type "$WEB/assets/$WORKER")" in
  text/javascript*|application/javascript*) ;;
  *) fail "/assets/$WORKER is not served as JavaScript (nosniff would block it)" ;;
esac
ok "CSP frame-ancestors, X-Frame-Options, nosniff, Referrer-Policy; pdf worker served as JavaScript"

STAMP="$(date +%s)-$RANDOM"
EMAIL="smoke-$STAMP@binder.test"
BINDER_PASSWORD="$(openssl rand -hex 16)"
export BINDER_PASSWORD

step "creating $EMAIL with the CLI inside the api container"
"${DC[@]}" exec -T -e BINDER_PASSWORD api node apps/api/dist/cli.js create-user \
  --email "$EMAIL" --name "Smoke $STAMP" >"$WORK/user-id" || fail "create-user failed"
ok "user $(cat "$WORK/user-id")"

step "signing in over HTTP"
curl -fsS -c "$WORK/jar" -H "Origin: $WEB" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$BINDER_PASSWORD\"}" \
  "$WEB/api/auth/sign-in/email" >/dev/null || fail "sign-in failed"
ok "signed in"

step "sync token"
curl -fsS -b "$WORK/jar" "$WEB/api/sync/token" >"$WORK/token.json" || fail "GET /api/sync/token failed"
TOKEN="$(json token <"$WORK/token.json")"
ENDPOINT="$(json endpoint <"$WORK/token.json")"
[ "$ENDPOINT" = "$SYNC" ] || fail "sync endpoint is $ENDPOINT, expected $SYNC"
ok "endpoint $ENDPOINT"

step "a show, replicated to PowerSync"
ORG_ID="$(curl -fsS -b "$WORK/jar" "$WEB/api/me/orgs" | json organisations.0.id)" || fail "no organisation"
SHOW_TITLE="Smoke Show $STAMP"
[ "$(status -b "$WORK/jar" -H 'Origin: https://evil.rvlt.app' -H 'content-type: application/json' \
  -d '{"title":"forged"}' "$WEB/api/orgs/$ORG_ID/shows")" = 403 ] || fail "a cookie POST from a foreign Origin was not refused"
SHOW_ID="$(curl -fsS -b "$WORK/jar" -H "Origin: $WEB" -H 'content-type: application/json' -d "{\"title\":\"$SHOW_TITLE\"}" \
  "$WEB/api/orgs/$ORG_ID/shows" | json show.id)" || fail "create show failed"
curl -sN --max-time 15 -D "$WORK/headers" -o "$WORK/stream" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$ENDPOINT/sync/stream" -d '{}' || true
[ "$(head -n1 "$WORK/headers" | awk '{print $2}')" = 200 ] || fail "PowerSync stream was not HTTP 200"
grep -q "$SHOW_TITLE" "$WORK/stream" || fail "the show did not arrive in the sync stream"
ok "foreign-Origin POST refused (403); show $SHOW_ID arrived through PowerSync (JWT secret, role grants and publication all work)"

step "upload the scanned fixture and wait for OCR"
UP="$(curl -fsS -b "$WORK/jar" -H "Origin: $WEB" -F kind=libretto -F "title=Scan $STAMP" -F ocrMode=auto \
  -F "file=@$SCAN_PDF;type=application/pdf" "$WEB/api/shows/$SHOW_ID/documents")" || fail "upload failed"
VERSION_ID="$(printf '%s' "$UP" | json version.id)" || fail "no version in upload response: $UP"
STATE=""
for _ in $(seq 1 120); do
  STATE="$(curl -fsS -b "$WORK/jar" "$WEB/api/shows/$SHOW_ID/documents" | node -e '
    const d=JSON.parse(require("fs").readFileSync(0,"utf8")).documents;
    const v=d.flatMap(x=>x.versions).find(v=>v.id===process.argv[1]);
    console.log(v?v.status:"missing")' "$VERSION_ID")"
  [ "$STATE" = ready ] || [ "$STATE" = failed ] && break
  sleep 1
done
[ "$STATE" = ready ] || fail "version $VERSION_ID is '$STATE', expected ready (docker compose logs api)"
OCR="$("${DC[@]}" exec -T postgres psql -U binder -d binder -Atc \
  "select count(*) filter (where ocr_applied), count(*) from pages where document_version_id='$VERSION_ID'")"
[ "${OCR%%|*}" -ge 1 ] || fail "ready but OCR was not applied to any page ($OCR)"
ok "version ready; pages with OCR applied|total = $OCR"

step "blobs are sandboxed but still readable by fetch"
SEARCHABLE="$("${DC[@]}" exec -T postgres psql -U binder -d binder -Atc \
  "select searchable_key from document_versions where id='$VERSION_ID'")"
BLOB_URL="$WEB/blobs/$SEARCHABLE"
curl -fsS -b "$WORK/jar" -D "$WORK/blob-headers" -o "$WORK/blob.pdf" "$BLOB_URL" || fail "GET $BLOB_URL failed"
grep -qi "^content-security-policy: sandbox; frame-ancestors 'self'" "$WORK/blob-headers" || fail "blob lacks CSP sandbox"
grep -qi '^x-content-type-options: nosniff' "$WORK/blob-headers" || fail "blob lacks nosniff"
[ "$(head -c 5 "$WORK/blob.pdf")" = '%PDF-' ] || fail "blob body is not the PDF"
ok "searchable.pdf: CSP sandbox, nosniff, %PDF- body"

step "MCP with a personal access token"
PAT="$("${DC[@]}" exec -T api node apps/api/dist/cli.js create-token --email "$EMAIL" --name smoke --scope '*')" \
  || fail "create-token failed"
case "$PAT" in bnd_*) ;; *) fail "create-token printed an unexpected value" ;; esac
(cd "$ROOT" && BINDER_TOKEN="$PAT" BINDER_MCP_URL="$WEB/mcp" node apps/api/scripts/mcp-smoke.ts) \
  >"$WORK/mcp.out" 2>&1 || { sed 's/bnd_[A-Za-z0-9_-]*/bnd_<redacted>/g' "$WORK/mcp.out" >&2; fail "mcp-smoke failed"; }
sed 's/^/    /' "$WORK/mcp.out" | cut -c1-200

echo PASS
