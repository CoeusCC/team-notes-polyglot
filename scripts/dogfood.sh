#!/usr/bin/env bash
# Dogfood: run the reference backend as the agents' shared scratchpad.
# It adds users `claude` and `grok` on team `team-agents`, with random tokens kept in .dogfood/tokens (gitignored).
#   scripts/dogfood.sh start|stop|export
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
D=.dogfood; PORT=${DOGFOOD_PORT:-3000}; mkdir -p $D
case ${1:-start} in
  start)
    [[ -f $D/tokens ]] || printf 'claude=tok_%s\ngrok=tok_%s\npatrick=tok_%s\n' $(openssl rand -hex 12) $(openssl rand -hex 12) $(openssl rand -hex 12) > $D/tokens
    (cd backends/node-ts && DB_PATH=../../$D/notes.db PORT=$PORT exec node src/server.ts) > $D/server.log 2>&1 &
    echo $! > $D/pid; sleep 1
    node -e '
      const { DatabaseSync } = require("node:sqlite"); const { createHash } = require("node:crypto");
      const db = new DatabaseSync(process.argv[1]);
      const toks = Object.fromEntries(require("fs").readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split("=")));
      db.prepare("INSERT OR IGNORE INTO teams (id, name, owner_id) VALUES (?, ?, ?)").run("team-agents", "Agents", "alice");
      for (const [u, t] of Object.entries(toks)) {
        db.prepare("INSERT OR IGNORE INTO users (id, name, token_hash) VALUES (?, ?, ?)").run(u, u[0].toUpperCase() + u.slice(1), createHash("sha256").update(t).digest("hex"));
        db.prepare("INSERT OR IGNORE INTO memberships (team_id, user_id, role) VALUES (?, ?, ?)").run("team-agents", u, u === "patrick" ? "owner" : "member");
      }' $D/notes.db $D/tokens
    echo "dogfood up on http://localhost:$PORT (team-agents). Tokens are in $D/tokens; never commit them." ;;
  stop) kill "$(cat $D/pid)" && rm -f $D/pid ;;
  export)
    t=$(grep '^claude=' $D/tokens | cut -d= -f2-)
    mkdir -p docs/dogfood
    { curl -sf -H "Authorization: Bearer $t" "http://localhost:$PORT/teams/team-agents/notes";
      echo; curl -sf -H "Authorization: Bearer $t" "http://localhost:$PORT/teams/team-agents/notes?archived=true"; } > docs/dogfood/notes.json
    echo "exported to docs/dogfood/notes.json" ;;
esac
