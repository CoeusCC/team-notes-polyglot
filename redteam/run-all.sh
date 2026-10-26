#!/usr/bin/env bash
# Start each backend on its own port with a fresh DB (setsid + pidfile; killed by PID/process group), run the fuzzer, stop them.
#   redteam/run-all.sh [seeds=1,2] [ops=1500] [backend...]
cd "$(dirname "$0")/.." || exit 1
ROOT=$PWD; SEEDS=${1:-1,2}; OPS=${2:-1500}; shift 2 2>/dev/null
declare -A PORT=( [node-ts]=3201 [deno]=3202 [php]=3203 [python]=3204 [rust]=3206 )
BS=("$@"); ((${#BS[@]})) || BS=(node-ts deno php python rust)
RUN=${TMPDIR:-/tmp}/redteam-run-$$; mkdir -p "$RUN"
targets=()
for b in "${BS[@]}"; do
  p=${PORT[$b]}; db=$RUN/$b.db
  if curl -sf -m 2 "http://127.0.0.1:$p/health" >/dev/null; then echo "port $p already in use; refusing to fuzz a foreign server" >&2; exit 3; fi
  if [[ $b == node-ts ]]; then (cd backends/node-ts && PORT=$p setsid node src/server.ts >"$RUN/$b.log" 2>&1 & echo $! >"$RUN/$b.pid")
  else (PORT=$p DB_PATH=$db setsid backends/$b/run.sh >"$RUN/$b.log" 2>&1 & echo $! >"$RUN/$b.pid"); fi
  for _ in $(seq 1 240); do curl -sf "http://127.0.0.1:$p/health" >/dev/null && break; sleep 0.5; done
  targets+=(--target "$b=http://127.0.0.1:$p")
done
node redteam/invariants.mjs "${targets[@]}" --seed "$SEEDS" --ops "$OPS" --out evidence/redteam.invariants
rc=$?
for b in "${BS[@]}"; do pid=$(cat "$RUN/$b.pid"); kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null; done
for b in "${BS[@]}"; do for _ in $(seq 1 20); do curl -sf -m 1 "http://127.0.0.1:${PORT[$b]}/health" >/dev/null || break; sleep 0.5; done; done
exit $rc
