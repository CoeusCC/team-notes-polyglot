# Scoreboard harness

One command runs every check on every backend, appends a row to `evidence/history.jsonl`, and regenerates `evidence/scoreboard.md` (latest table, trend with deltas, ranked **Improvement queue**).

    node harness/scoreboard.mjs [--quick] [--backends node-ts,deno,php,python,rust] [--label "why this run"]

`--quick` = bench `--runs 1 --duration 2`; default is `--runs 3 --duration 4`. A full 5-backend run takes several minutes; a quick 2-backend run about 40 s.

## What it runs (existing harnesses, not rewrites)

1. `scripts/conform-all.sh --allow-dirty <backends>` -> cases, AC verdicts (`evidence/<b>.json`, `evidence/matrix.md`)
2. `bench/run-local.sh -b <backends>` -> composite score, gates, p99 and req/s per scenario, lost updates, leaks
3. `scripts/falsify.sh` (node-ts only; skipped if node-ts not selected) -> CAUGHT / MISSED faults
4. Ingests `evidence/redteam.invariants.json` and `evidence/redteam.mutation*.json` if present (skipped silently otherwise). These are read as-is: run `redteam/run-all.sh` yourself to refresh them; the row records their `generated` time.

Servers are started and killed by PID inside those scripts. Do not use `pkill -f`.

## The loop

1. **Run the scoreboard** (use `--label` to say what you changed).
2. **Take the top item** of the Improvement queue in `evidence/scoreboard.md`.
3. **Fix it, tests first**: add or tighten a case in `conformance/cases.json` (or a redteam test) that fails for the reason in the evidence, then change the backend until it passes.
4. **Re-run** the scoreboard with a label naming the fix.
5. **Compare the delta** in the Trend table. Keep the change only if the targeted item disappeared and nothing regressed (cases passed, score, new queue items).

Queue priority: 1 refuted AC, 2 missed fault, 3 red-team invariant violation, 4 surviving mutant, 5 ratified AC with fewer than 2 cases, 6 bench gate failure, 7 slowest p99 scenario per backend, 8 backend scoring under 50% of the leader.

Notes: bench scores are relative within one run (best backend = 100), so compare trends only between runs with the same backend set and mode (`[quick]` is marked in the trend). Rows made on a dirty tree are marked `*`. `history.jsonl` is append-only; never edit old rows.

## Prompt template for one iteration

```
You are improving the bluestaq repo (the repo root) by one scoreboard iteration.
1. Read evidence/scoreboard.md. Pick the TOP item of the Improvement queue (if you were assigned a
   backend, the top item that names it). Do not touch other backends or unrelated files.
2. Reproduce it from the evidence line (conformance case ids, red-team repro command, fault name).
3. Tests first: add/strengthen the case or test so it fails for the right reason; confirm it fails.
4. Make the minimal fix. Do not weaken tests or edit expected values to make them pass.
5. Re-run: node harness/scoreboard.mjs --quick --backends <affected backends> --label "<item you fixed>"
6. Compare against the previous row in the Trend table. Report: the item, files changed, the delta
   (cases passed, refuted ACs, score), and any new queue items that appeared. Do not commit or push.
If the item cannot be fixed in the time box, say why and report the next candidate instead.
```
