#!/usr/bin/env bash
# Usage: bench/run-local.sh [-b node-ts,python] [bench.mjs args...]  (defaults: --runs 3 --duration 5 --concurrency 32)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
BACKENDS=""
if [ "${1:-}" = "-b" ]; then BACKENDS="${2//,/ }"; shift 2; fi
if [ -z "$BACKENDS" ]; then
  for d in "$ROOT"/backends/*/; do
    b="$(basename "$d")"
    if [ "$b" = node-ts ] || [ -x "$d/run.sh" ] || [ -f "$d/run.sh" ]; then BACKENDS="$BACKENDS $b"; fi
  done
fi
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; sleep 0.3; for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
ARGS=(); PORT=4001
for b in $BACKENDS; do
  d="$ROOT/backends/$b"; [ -d "$d" ] || { echo "skip $b: no dir"; continue; }
  export_db="$TMP/$b.db"
  if [ "$b" = node-ts ]; then
    (cd "$d" && PORT=$PORT DB_PATH="$export_db" exec node src/server.ts) >"$TMP/$b.log" 2>&1 &
  elif [ -f "$d/run.sh" ]; then
    (cd "$d" && PORT=$PORT DB_PATH="$export_db" exec bash ./run.sh) >"$TMP/$b.log" 2>&1 &
  else echo "skip $b: no run.sh"; continue; fi
  pid=$!; echo "$pid" > "$TMP/$b.pid"; PIDS+=("$pid")
  ok=0; for _ in $(seq 1 100); do
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && { ok=1; break; }
    kill -0 "$pid" 2>/dev/null || break; sleep 0.2
  done
  if [ $ok = 1 ]; then ARGS+=(--target "$b=http://127.0.0.1:$PORT"); echo "started $b on $PORT (pid $pid)"
  else echo "FAILED to start $b; log:"; tail -n 15 "$TMP/$b.log"; fi
  PORT=$((PORT+1))
done
[ ${#ARGS[@]} -gt 0 ] || { echo "no backends running"; exit 1; }
mkdir -p "$ROOT/bench/results" 2>/dev/null; mkdir -p "$ROOT/bench/results"
TS="$(date +%Y%m%d-%H%M%S)"
DEFAULTS=(--runs 3 --duration 5 --concurrency 32)
node "$ROOT/bench/bench.mjs" "${ARGS[@]}" "${DEFAULTS[@]}" "$@" --json "$ROOT/bench/results/$TS.json"
