# Agent rules (Claude Code, Grok bots, humans)

These rules apply to every contributor, human or agent.

## Source of truth
1. `spec/openapi.yaml` and the **ratified** cards in `spec/acceptance-criteria.md` define behavior. Code that disagrees with them is wrong.
2. A behavior change starts as an AC card plus a conformance case in `conformance/cases.json`, and the spec changes in the same PR.
3. Patrick (human) ratifies ACs. Agents may propose and draft them but never ratify.

## Separation of duties
- Never record verdicts or evidence (`evidence/`, digest verdict lines) for code you wrote yourself.
- Adversarial review is done by an agent that did not implement the change.

## Workflow
- Issues live on the GitHub Project "Team Notes". Claim an issue by assigning yourself and commenting *before* you start.
- Keep issues to 30 minutes of work or less, and PRs small. Title PRs `<AC alias or task>: <summary>` and include `Closes #N`.
- A PR is mergeable only when `node --test` and the conformance run are green.
- Every gate gets an entry in `docs/build-digest.md`, made with `scripts/digest.sh`.
- Go/no-go recommendations go to the "Plan & gates" Discussion. Agent-to-agent messages go to the "Bot bus" Discussion.
- Never commit secrets: no tokens, webhook secrets or `.env` files.

## Engineering discipline
Follow `.claude/skills/ub-mode/SKILL.md`:
- Write the failing test first.
- Check input at the boundary, and keep business logic pure inside.
- Make operations idempotent.
- Work in small verifiable units.
- Commit often, and say why, what changed and how you proved it.

## Running things
- Reference backend: `cd backends/node-ts && npm start`, which serves on port 3001.
- Conformance: `(cd conformance && npm ci)` once, then `BASE_URL=http://localhost:3001 node conformance/run.mjs`.
- Multi-agent fan-out (Claude): use `/workflows`, and always set the model explicitly. Use **Sonnet** for implementation and **Haiku** for research or lookups. Use Opus only for orchestration and adversarial review.

## Assessing this repo (reviewer agents)
See also `START-HERE.md`.
- **Authoritative:** `spec/` (contract, schema, ratified ACs), `conformance/cases.json`, `docs/adr/`, `backends/*`, the newest `Evidence:` commit and `evidence/matrix.md`.
- **Not authoritative:** `docs/PLAN.md` (superseded by spec and ADRs), `docs/handoff/`, `harness/`, `evidence/history.jsonl`, `evidence/*-red.txt` (deliberately failing runs), and every non-`main` branch (`grok/*` and similar are agent workspaces).
- **Verify, don't trust:** `scripts/conform-all.sh` re-runs every backend against the suite (needs a clean tree); `scripts/falsify.sh` injects faults the suite must catch; `(cd backends/node-ts && node --test test/)` runs the unit tests. A "red first" commit at the tip fails on purpose until its fix lands.
- **Out of scope by design:** what README.md lists under "What I'd change". Don't count a missing feature as a defect unless an AC or the spec requires it.
