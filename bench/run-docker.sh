#!/usr/bin/env bash
# Usage: bench/run-docker.sh [bench.mjs args...]  (each container: 1 CPU, 512 MB)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/bench"
cleanup() { docker compose down -v >/dev/null 2>&1; }
trap cleanup EXIT INT TERM
docker compose up -d --build || exit 1
ARGS=()
# map service -> host port from compose config
while read -r name port; do
  ok=0; for _ in $(seq 1 100); do curl -sf "http://127.0.0.1:$port/health" >/dev/null && { ok=1; break; }; sleep 0.3; done
  if [ $ok = 1 ]; then ARGS+=(--target "$name=http://127.0.0.1:$port"); echo "$name healthy on $port"; else echo "$name FAILED health"; docker compose logs "$name" | tail -n 15; fi
done < <(docker compose config --format json | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const [n,s] of Object.entries(c.services))console.log(n,s.ports[0].published)')
[ ${#ARGS[@]} -gt 0 ] || exit 1
mkdir -p "$ROOT/bench/results"
node "$ROOT/bench/bench.mjs" "${ARGS[@]}" --runs 3 --duration 5 --concurrency 32 "$@" --json "$ROOT/bench/results/docker-$(date +%Y%m%d-%H%M%S).json"
