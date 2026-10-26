#!/usr/bin/env bash
# Append a build-digest entry to docs/build-digest.md.
# Usage: scripts/digest.sh "<tier/gate label>" "<decision + why>" [test-output-file...]
# Mechanical fields come from git and gh. The label and decision come from the caller.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

label=${1:?label required}
decision=${2:?decision required}
shift 2

sha=$(git rev-parse --short HEAD)
builddigest=$(git ls-tree -r HEAD | sha256sum | cut -c1-16)
dirty=$(git status --porcelain | wc -l)

{
  echo
  echo "## $(date -Iseconds) · $label"
  echo "- commit \`$sha\` · builddigest \`$builddigest\` · uncommitted files: $dirty"
  for f in "$@"; do
    echo "- \`$f\` sha256 \`$(sha256sum "$f" | cut -c1-16)\` · $(tail -n 3 "$f" | tr '\n' ' ')"
  done
  if gh repo view >/dev/null 2>&1; then
    gh issue list --state closed --limit 200 --json number,createdAt,closedAt \
      --jq 'if length == 0 then "- cycle time: no closed issues yet"
            else (map((.closedAt|fromdate) - (.createdAt|fromdate)) | sort) as $d
              | "- cycle time: \($d|length) closed issues · median \(($d[($d|length/2|floor)]/60)|floor) min"
            end' || true
  fi
  echo "- decision: $decision"
} >> docs/build-digest.md

echo "digest entry appended for $sha ($builddigest)"
