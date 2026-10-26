# Start here

A one-page map for a reviewer, human or agent. [README.md](README.md) has the design choices and tradeoffs; this page tells you where things are and how to check them.

## What this is
A REST backend for a note-taking service shared by small teams. One contract (`spec/openapi.yaml`, `spec/schema.sql`, `spec/acceptance-criteria.md`) is implemented five times (`backends/node-ts`, `deno`, `php`, `python`, `rust`) and checked by one data-only conformance suite (`conformance/`).

## 60-second path
Run from a fresh clone. Commands below were run on a fresh clone before this page was committed.

```sh
# 1. Reference backend (Node 26+, no npm install needed to run it)
cd backends/node-ts && npm start            # listens on :3001 (PORT= overrides)

# 2. Second shell, repo root: conformance suite
(cd conformance && npm ci)                  # one-time: ajv, ajv-formats, yaml
BASE_URL=http://localhost:3001 node conformance/run.mjs

# 3. Unit tests for the reference backend
(cd backends/node-ts && node --test test/)

# 4. All five backends, AC × backend matrix (needs node, deno, php, python3, cargo)
scripts/conform-all.sh                      # refuses a dirty tree; --allow-dirty to iterate
```

`conform-all.sh` uses ports 3101–3106 and rewrites `evidence/<backend>.{json,txt}` and `evidence/matrix.md`, so run `git checkout -- evidence` afterwards if you don't want the diff. If the tip of `main` is a "red first" commit, some cases fail on purpose until the fix commit lands. The last official run is in the newest `Evidence:` commit.

## Where things live
| Path | What | Authority |
|---|---|---|
| `spec/` | OpenAPI contract, SQL schema, AC cards | Source of truth |
| `conformance/cases.json` | Executable cases, each tagged with AC ids | Source of truth for tests |
| `docs/adr/` | Decisions 0001–0006 and why | Authoritative |
| `backends/*` | Implementations | Must match `spec/` |
| `evidence/` | Verdicts, matrix, bench, red-team results | Read the newest; `history.jsonl` is the raw log |
| `scripts/` | `conform-all.sh`, `falsify.sh` (injects faults the suite must catch), `dogfood.sh`, `demo.sh`, `digest.sh` | Tools |
| `redteam/`, `bench/` | Invariant and mutation runs, throughput bench | Supporting |
| `docs/build-digest.md` | Gate-by-gate log of the build | Narrative |

## Read first
1. `README.md`, then 2. `spec/acceptance-criteria.md`, then 3. `docs/adr/`, then 4. `evidence/matrix.md`.

## Safe to ignore
`docs/handoff/` (prompts used to start agents), `docs/PLAN.md` (the original plan; the ADRs and spec supersede it), `harness/` (scoreboard tooling), `evidence/history.jsonl` and `*-red.txt` (raw and intentionally failing runs), and any `grok/*` or other non-`main` branch (agent workspaces, not part of the submission).

## The commit history
`git log --reverse --oneline main` reads as the build: plan and ADR-0001 first, then the spec and conformance suite, then backends tier by tier. Behavior changes follow the pattern *AC + case (red first)* → *implementation* → *`Evidence:` commit* with the verified run. Agents worked under `AGENTS.md`; Patrick ratified the ACs.
