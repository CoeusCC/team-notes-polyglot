#!/usr/bin/env bash
# Verdict runner: start each backend, run the conformance suite against it, and write evidence/<backend>.json
# plus an AC × backend matrix (evidence/matrix.md). This follows SpecDLC-Research/specs/verdict-runner.md:
# it refuses a dirty tree (pass --allow-dirty for local iteration) and stamps each run with the builddigest.
#   scripts/conform-all.sh [--allow-dirty] [backend...]
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

allow_dirty=0
[[ ${1:-} == --allow-dirty ]] && { allow_dirty=1; shift; }
if (( !allow_dirty )) && [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo "refusing: uncommitted changes (verdicts must describe a committed build)" >&2; exit 2
fi

# backend  port  start-command (run from the repo root)
declare -A PORT=( [node-ts]=3101 [deno]=3102 [php]=3103 [python]=3104 [rust]=3106 )
start() {
  local b=$1 p=$2
  case $b in
    node-ts) (cd backends/node-ts && PORT=$p exec node src/server.ts) ;;
    *)       PORT=$p DB_PATH=${TMPDIR:-/tmp}/notes-$b-$$.db exec backends/$b/run.sh ;;
  esac
}

backends=("$@")
(( ${#backends[@]} )) || for d in backends/*/; do b=$(basename "$d"); [[ -n ${PORT[$b]:-} ]] && backends+=("$b"); done

sha=$(git rev-parse --short HEAD)
builddigest=$(git ls-tree -r HEAD | sha256sum | cut -c1-16)
mkdir -p evidence
status=0
for b in "${backends[@]}"; do
  p=${PORT[$b]}
  if curl -sf "http://localhost:$p/health" >/dev/null 2>&1; then echo "$b: port $p already serving; refusing (stale server would fake verdicts)" >&2; status=1; continue; fi
  start "$b" "$p" >"evidence/$b.server.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 120); do curl -sf "http://localhost:$p/health" >/dev/null && break; sleep 0.5; done
  BASE_URL=http://localhost:$p node conformance/run.mjs --strict --json "evidence/$b.json" >"evidence/$b.txt" 2>&1
  rc=$?
  kill "$pid" 2>/dev/null; pkill -P "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  node -e '
    const f = process.argv[1], e = JSON.parse(require("fs").readFileSync(f));
    Object.assign(e, { backend: process.argv[2], commit: process.argv[3], builddigest: process.argv[4], at: new Date().toISOString() });
    require("fs").writeFileSync(f, JSON.stringify(e, null, 2));' "evidence/$b.json" "$b" "$sha" "$builddigest" 2>/dev/null
  echo "$b: $(tail -n 1 "evidence/$b.txt")"
  (( rc == 0 )) || status=1
done

# AC × backend matrix
SHA=$sha BD=$builddigest node -e '
  const fs = require("fs");
  const bs = process.argv.slice(1).filter((b) => fs.existsSync(`evidence/${b}.json`));
  const ev = Object.fromEntries(bs.map((b) => [b, JSON.parse(fs.readFileSync(`evidence/${b}.json`))]));
  const acs = [...new Set(bs.flatMap((b) => Object.keys(ev[b].acVerdicts)))].sort();
  const icon = { passed: "✅", refuted: "❌", unverified: "⚪" };
  let md = `# Conformance matrix\n\ncommit \`${process.env.SHA}\` · builddigest \`${process.env.BD}\` · ${new Date().toISOString()}\n\n| AC | ${bs.join(" | ")} |\n|---|${bs.map(() => "---").join("|")}|\n`;
  for (const ac of acs) md += `| ${ac} | ${bs.map((b) => icon[ev[b].acVerdicts[ac]] ?? "—").join(" | ")} |\n`;
  md += `| **cases passed** | ${bs.map((b) => `${ev[b].results.filter((r) => r.passed).length}/${ev[b].results.length}`).join(" | ")} |\n`;
  fs.writeFileSync("evidence/matrix.md", md);
' "${backends[@]}"
echo "wrote evidence/matrix.md"
exit $status
