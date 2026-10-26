#!/usr/bin/env bash
# Tier 1 demo: Alice writes a note, Bob (same team) reads and edits it, Carol (other team) can't see it.
# Usage: BASE_URL=http://localhost:3001 scripts/demo.sh   (start a backend first)
set -euo pipefail
B=${BASE_URL:-http://localhost:3001}
say(){ printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
call(){ local who=$1; shift; curl -sS -w '  → HTTP %{http_code}\n' -H "Authorization: Bearer tok_$who" -H 'content-type: application/json' "$@"; echo; }

say "Alice: who am I?";                 call alice "$B/me"
say "Alice creates a note in team-red"
id=$(curl -sS -H 'Authorization: Bearer tok_alice' -H 'content-type: application/json' \
      -d '{"title":"Sprint goals","body":"Ship the notes API"}' "$B/teams/team-red/notes" | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "  note id: $id"
say "Bob (team-red member) reads it";   call bob "$B/notes/$id"
say "Bob edits the title";              call bob -X PATCH -d '{"title":"Sprint goals (v2)"}' "$B/notes/$id"
say "Carol (team-blue) tries to read it, gets 404 (no existence leak)"; call carol "$B/notes/$id"
say "Carol tries to list team-red, gets 404";                          call carol "$B/teams/team-red/notes"
say "No token, gets 401";              curl -sS -w '  → HTTP %{http_code}\n' "$B/me"; echo
say "Validation: empty title, gets 422"; call alice -d '{"title":"  "}' "$B/teams/team-red/notes"
