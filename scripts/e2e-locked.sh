#!/usr/bin/env bash
# Run Binder's Playwright e2e from ONE checkout at a time.
#
#   bash scripts/e2e-locked.sh [<checkout-root>] [e2e|e2e:offline|e2e:all] [spec filters...]
#   pnpm e2e [spec filters...]            # the same, for this checkout (package.json)
#   pnpm e2e:offline
#
# Why: the e2e config starts the API on :3000, the web dev server on :5173 and the preview on :4173,
# and on a dev machine Playwright REUSES a server that is already listening. With two sessions or
# worktrees running e2e, the second silently tests the first one's code. This script takes a
# machine-wide lock, frees those ports, forces fresh servers (CI=1 turns reuseExistingServer off)
# and releases the lock when the run ends, however it ends.
#
# Never run `pnpm e2e` inside apps/web directly when another session may be running.
#
# Overrides (mainly for testing this script):
#   BINDER_E2E_LOCK   lock directory (default /tmp/binder-e2e.lock)
#   BINDER_E2E_PORTS  ports to free before the run (default "3000 5173 4173"; empty = free none)
#
# WARNING: it kills whatever is listening on those ports, including your own dev servers.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The first argument is a checkout root only if it looks like one (an `e2e` folder must not match).
if [ "$#" -gt 0 ] && [ -f "$1/apps/web/package.json" ]; then ROOT="$(cd "$1" && pwd)"; shift; else ROOT="$HERE"; fi
SCRIPT="${1:-e2e}"; shift || true
LOCK="${BINDER_E2E_LOCK:-/tmp/binder-e2e.lock}"
PORTS="${BINDER_E2E_PORTS-3000 5173 4173}"
export PATH="$HOME/Library/pnpm:$PATH"

case "$SCRIPT" in
  e2e | e2e:offline | e2e:all) ;;
  *) echo "e2e-locked: unknown script '$SCRIPT' (use e2e, e2e:offline or e2e:all)" >&2; exit 2 ;;
esac
[ -f "$ROOT/apps/web/package.json" ] || { echo "e2e-locked: $ROOT is not a Binder checkout" >&2; exit 2; }
[ -w "$(dirname "$LOCK")" ] || { echo "e2e-locked: cannot create the lock in $(dirname "$LOCK")" >&2; exit 2; }

waited=0
until mkdir "$LOCK" 2>/dev/null; do
  # A lock whose owner process is gone (crash, kill -9) would block everyone forever: take it over.
  owner_pid="$(sed -n 's/.*(\([0-9][0-9]*\)).*/\1/p' "$LOCK/owner" 2>/dev/null | head -1)"
  if [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null; then
    echo "e2e-locked: previous owner ($owner_pid) is gone, taking the lock over"
    rm -rf "$LOCK"; continue
  fi
  if [ $((waited % 60)) -eq 0 ]; then
    echo "e2e-locked: waiting for $(cat "$LOCK/owner" 2>/dev/null || echo 'another run')..."
  fi
  sleep 5; waited=$((waited + 5))
done
echo "$ROOT ($$) since $(date +%T)" > "$LOCK/owner"
# Release the lock on every way out. INT and TERM must EXIT (a bare handler would return and carry on,
# running the suite without the lock), which in turn fires the EXIT trap.
trap 'rm -rf "$LOCK"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

listeners() { lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null || true; }

for port in $PORTS; do
  pids=$(listeners "$port")
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
done
# Servers need a moment to let go of their ports; Playwright with CI=1 fails on a busy one. Wait up to
# 10 s, then kill any straggler outright.
for _ in $(seq 1 20); do
  busy=""
  for port in $PORTS; do [ -n "$(listeners "$port")" ] && busy=1; done
  [ -z "$busy" ] && break
  sleep 0.5
done
for port in $PORTS; do
  pids=$(listeners "$port")
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
done

cd "$ROOT/apps/web" && CI=1 pnpm "$SCRIPT" "$@"
