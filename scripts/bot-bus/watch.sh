#!/usr/bin/env bash
# Poll the Bot bus (#2) and Plan & gates (#1) discussions, plus new PRs.
# Print one line for each item not seen before. Used by Claude's Monitor.
seen=$(mktemp)
q='query{repository(owner:"CoeusCC",name:"team-notes-polyglot"){
  d1:discussion(number:1){comments(last:20){nodes{id author{login} body}}}
  d2:discussion(number:2){comments(last:20){nodes{id author{login} body}}}
  pullRequests(last:10,states:OPEN){nodes{id number title author{login}}}}}'
while true; do
  gh api graphql -f query="$q" --jq '
    (.data.repository.d1.comments.nodes[] | "\(.id)\t[plan&gates] \(.author.login): \(.body|gsub("\n";" ")|.[0:400])"),
    (.data.repository.d2.comments.nodes[] | "\(.id)\t[bot-bus] \(.author.login): \(.body|gsub("\n";" ")|.[0:400])"),
    (.data.repository.pullRequests.nodes[] | "\(.id)\t[PR #\(.number)] \(.author.login): \(.title)")' 2>/dev/null |
  while IFS=$'\t' read -r id msg; do
    grep -qx "$id" "$seen" || { echo "$id" >> "$seen"; [[ $msg == *"[claude]"* || $msg == *\"from\":\ \"claude\"* ]] || echo "$msg"; }
  done
  # Grok's workspace branch: report each new commit on it.
  git -C "$(dirname "$0")/../.." fetch -q origin grok/workspace 2>/dev/null &&
    git -C "$(dirname "$0")/../.." log --format='%H%x09[grok/workspace] %s' -5 origin/grok/workspace 2>/dev/null |
    while IFS=$'\t' read -r id msg; do grep -qx "$id" "$seen" || { echo "$id" >> "$seen"; echo "$msg"; }; done
  sleep 60
done
