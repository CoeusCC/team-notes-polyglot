#!/usr/bin/env bash
# Falsification: start the backend with each deliberate fault and prove the conformance suite goes red.
# Prints "CAUGHT <fault> by <refuted ACs>" or "MISSED <fault>"; exits non-zero if any fault is MISSED.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=3101
FAULTS=(ignore-if-match hard-delete restore-keeps-version leak-403 no-trim)
WORK="$(mktemp -d)"
PIDFILE="$WORK/server.pid"
missed=0

stop_server() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    wait "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
  fi
}
trap 'stop_server; rm -rf "$WORK"' EXIT

for f in "${FAULTS[@]}"; do
  # Fresh in-memory DB per fault: the server is a new process with DB_PATH=:memory:.
  # cd first, then background node itself, so $! is node's pid (not a wrapper subshell's).
  cd "$ROOT/backends/node-ts" || exit 2
  FAULT="$f" PORT=$PORT DB_PATH=:memory: node src/server.ts >"$WORK/server.log" 2>&1 &
  echo $! >"$PIDFILE"
  cd "$ROOT" || exit 2
  up=0
  for _ in $(seq 50); do curl -sf "http://localhost:$PORT/health" >/dev/null && { up=1; break; }; sleep 0.1; done
  if [ "$up" -ne 1 ]; then echo "ERROR $f: server did not start (port $PORT busy?)"; cat "$WORK/server.log"; stop_server; exit 2; fi
  BASE_URL="http://localhost:$PORT" node "$ROOT/conformance/run.mjs" --strict --json "$WORK/out.json" >"$WORK/run.log" 2>&1
  status=$?
  stop_server
  refuted="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(Object.entries(r.acVerdicts).filter(([,v])=>v==="refuted").map(([k])=>k).join(" "))' "$WORK/out.json" 2>/dev/null)"
  if [ "$status" -ne 0 ] && [ -n "$refuted" ]; then
    echo "CAUGHT $f by $refuted"
  else
    echo "MISSED $f"; missed=1
  fi
done
exit $missed
