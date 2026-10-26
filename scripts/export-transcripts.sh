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
  # Order matters: secrets first, then identity/privacy, then generic token shapes.
  # Dev tokens tok_alice/bob/carol are public by design. Sensitive literals (names, emails,
  # employer) live in the gitignored .redact-patterns file ("sed-regex<TAB>replacement" per line),
  # so this script never spells them out.
  local args=() extra=""
  [[ -f .dogfood/tokens ]] && extra=$(cut -d= -f2 .dogfood/tokens | paste -sd'|')
  if [[ -f .redact-patterns ]]; then
    while IFS=$'\t' read -r re rep; do [[ -n $re ]] && args+=(-e "s#$re#$rep#gI"); done < .redact-patterns
  fi
  sed -E \
    -e 's/(gh[opsu]_)[A-Za-z0-9]{20,}/\1REDACTED/g' \
    -e 's/(github_pat_)[A-Za-z0-9_]{20,}/\1REDACTED/g' \
    -e 's/(sk-ant-[a-z0-9-]*)[A-Za-z0-9_-]{20,}/\1REDACTED/g' \
    -e 's/(AKIA)[A-Z0-9]{16}/\1REDACTED/g' \
    -e 's/xox[baprs]-[A-Za-z0-9-]+/xox-REDACTED/g' \
    -e 's/(Bearer +)[A-Za-z0-9._~+\/-]{32,}/\1REDACTED/g' \
    -e 's/-----BEGIN [A-Z ]*PRIVATE KEY-----.*-----END [A-Z ]*PRIVATE KEY-----/[PRIVATE KEY REDACTED]/g' \
    -e 's#/tmp/claude-[0-9]+#<tmp>#g' \
    "${args[@]}" \
    -e "s#/home/$USER#~#g" \
    -e "s#$USER#user#g" \
    -e 's#[A-Za-z0-9._%+-]+@(outlook|gmail|hotmail|yahoo|icloud|proton)\.(com|me)#<email>#gI' \
    ${extra:+-e "s/($extra)/tok_REDACTED/g"}
}
redact < "$SRC/$SID.jsonl" > "$OUT/main-session.jsonl"
for f in "$SRC/$SID"/subagents/*; do redact < "$f" > "$OUT/subagents/$(basename "$f")"; done
# Post-check: fail loudly if anything token-shaped survived.
# Post-check: fail loudly if anything secret- or identity-shaped survived.
deny="gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9-]{20,}|/tmp/claude-[0-9]|xox[baprs]-[A-Za-z0-9]|BEGIN [A-Z ]*PRIVATE KEY-----(\\n|\\r|\s)*[A-Za-z0-9+/]{40}|$USER"
[[ -f .redact-deny ]] && deny="$deny|$(paste -sd'|' .redact-deny)"   # literal words that must never appear (gitignored)
if grep -rEqi "$deny" "$OUT"; then
  echo "secret- or identity-shaped string survived redaction:" >&2
  grep -rEoi "$deny" "$OUT" | sort | uniq -c | head >&2; exit 1; fi
ls "$OUT/subagents" | wc -l | xargs echo "subagent transcripts:"
du -sh "$OUT"
