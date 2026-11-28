#!/usr/bin/env bash
# Full regression: type check, unit tests, Rust tests + clippy, schema validator check, and every
# Playwright suite against the real Linux binary in web mode (fresh bench folders per suite).
#
# Usage: e2e/run_all.sh [--no-build]     (needs: node, cargo, python3 + playwright, xvfb-run)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
BIN=$ROOT/src-tauri/target/release/vision-studio
WORK=$(mktemp -d /tmp/vs-regression.XXXX)
export SHOTS=$WORK/shots; mkdir -p "$SHOTS"
PIDS=()
cleanup() {
  local rc=$?
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] || continue; pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  exit $rc
}
trap cleanup EXIT
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "typecheck";            npx tsc -b
step "schema validator";     node scripts/gen-tester-validator.mjs --check
step "unit tests";           npx vitest run
step "rust tests";           (cd src-tauri && cargo test --release --quiet)
step "clippy";               (cd src-tauri && cargo clippy --release --quiet -- -D warnings)
if [ "${1:-}" != "--no-build" ]; then step "build binary"; npx tauri build --no-bundle >"$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; exit 1; }; fi

# bench <name> [with-fixtures]: <WORK>/<name>/tools/vision_studio/{vision-studio,ini} (+ project files, bit files, …)
bench() {
  local b=$WORK/$1; mkdir -p "$b/tools/vision_studio" "$b/configurations/project_configuration"
  [ "${2:-}" = fixtures ] && cp -r e2e/fixtures/bench/. "$b/"
  cp "$BIN" "$b/tools/vision_studio/"
  cp config/vision-studio.ini "$b/tools/vision_studio/vision-studio.ini"
  echo "$b"
}
# serve <bench> <port>: start the binary in web mode and wait for the API
serve() {
  (cd "$1/tools/vision_studio" && exec xvfb-run -a ./vision-studio --mode web --port "$2" --no-browser >"$1/vs.log" 2>&1) &
  PIDS+=($!)
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$2/api/files/project" >/dev/null && return; sleep 0.25; done
  cat "$1/vs.log"; return 1
}

step "static web build (flow, settings)"
python3 -m http.server 18790 -d dist >"$WORK/http.log" 2>&1 & PIDS+=($!); sleep 1
python3 e2e/flow.py http://127.0.0.1:18790/ "$SHOTS"
python3 e2e/settings.py http://127.0.0.1:18790/ "$SHOTS"

step "project folder (binary)"
B=$(bench project); serve "$B" 18791
python3 e2e/project_folder.py http://127.0.0.1:18791/ "$B/configurations/project_configuration"

step "bench settings (binary)"
B=$(bench settings); serve "$B" 18792
python3 e2e/bench_settings.py http://127.0.0.1:18792/ "$B/tools/vision_studio/ui_config.json"

step "tester (binary)"
B=$(bench tester fixtures); serve "$B" 18793
python3 e2e/tester.py http://127.0.0.1:18793/ "$B"

step "large tree (binary, ≈1300 rows)"
B=$(bench large fixtures); npx vite-node perf/perf.ts --write "$B" >/dev/null; serve "$B" 18794
python3 e2e/large_tree.py http://127.0.0.1:18794/

step "all passed"; echo "screenshots: $SHOTS"
