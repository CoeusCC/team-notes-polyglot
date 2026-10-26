#!/usr/bin/env bash
# Export this Claude Code session's transcript and every subagent's transcript into docs/transcripts/,
# with secrets redacted (GitHub tokens, the dogfood tokens, bearer tokens other than the documented dev tokens).
#   scripts/export-transcripts.sh <session-id>
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
SID=${1:?session id}
SRC=${SRC:-$HOME/.claude/projects/$(git rev-parse --show-toplevel | tr / -)}
OUT=docs/transcripts; mkdir -p "$OUT/subagents"
redact() {
  # Order matters: specific secrets first, then generic token shapes. The dev tokens tok_alice/bob/carol are public by design.
  local extra=""
  [[ -f .dogfood/tokens ]] && extra=$(cut -d= -f2 .dogfood/tokens | paste -sd'|')
  sed -E \
    -e 's/(gh[opsu]_)[A-Za-z0-9]{20,}/\1REDACTED/g' \
    -e 's/(github_pat_)[A-Za-z0-9_]{20,}/\1REDACTED/g' \
    -e 's/(sk-ant-[a-z0-9-]*)[A-Za-z0-9_-]{20,}/\1REDACTED/g' \
    -e 's/(AKIA)[A-Z0-9]{16}/\1REDACTED/g' \
    ${extra:+-e "s/($extra)/tok_REDACTED/g"}
}
redact < "$SRC/$SID.jsonl" > "$OUT/main-session.jsonl"
for f in "$SRC/$SID"/subagents/*; do redact < "$f" > "$OUT/subagents/$(basename "$f")"; done
# Post-check: fail loudly if anything token-shaped survived.
if grep -rEq 'gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9-]{20,}' "$OUT"; then
  echo "secret-shaped string survived redaction" >&2; exit 1; fi
ls "$OUT/subagents" | wc -l | xargs echo "subagent transcripts:"
du -sh "$OUT"
