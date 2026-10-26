# Build digest

This is an append-only log, with one entry per gate and per significant commit. `builddigest` is the sha256 (shortened) of `git ls-tree -r HEAD`, following `SpecDLC-Research/specs/verdict-runner.md`. Mechanical fields come from `scripts/digest.sh`. The decision lines are written by hand.

Clock: Patrick's TestGorilla timer is the authority. It started at **14:48 CDT**. Feature freeze is at **16:48** (T+120), target submission at **17:35**, and the hard stop at **17:48**. Corrected at 15:30. Claude's session started late, at 15:11; the first entries record that wall-clock time.


## 2026-10-26T15:22:00-05:00 · Gate 1 candidate: Tier 1 MVP (node-ts)
- commit `d181a98` · builddigest `faefe5e0b366707a` · uncommitted files: 0
- `evidence/node-ts.tier1.txt` sha256 `e8b66215668196f0` · ok   unknown-route-problem [NOTES-TECH-ERR-1]  27/27 cases passed · ACs: 11/11 passed · BASE_URL=http://localhost:3001 
- cycle time: no closed issues yet
- decision: GO pending Patrick's AC ratification: 27/27 cases, 11/11 ACs, 17/17 unit, tsc clean, clean-clone quickstart+demo verified. Verdicts recorded by Claude (orchestrator/runner author); implementation by a Sonnet subagent. Grok spec review pending.

## 2026-10-26T15:29:00-05:00 · Gate 1: GO (Tier 1 ratified)
- commit `815cfb4` · builddigest `982fe307271eb97d` · uncommitted files: 0
- `evidence/node-ts.tier1.txt` sha256 `7c0e71d3abae7321` · ok   payload-too-large [NOTES-TECH-ERR-1]  30/30 cases passed · ACs: 11/11 passed · BASE_URL=http://localhost:3001 
- cycle time: no closed issues yet
- decision: GO. Patrick ratified the Tier 1 ACs. 30/30 cases, 11/11 ACs. Tier 2 decisions recorded in ADR-0002; Tier 2 cards await ratification.

## 2026-10-26T15:36:15-05:00 · Gate 3 (early): Path B, rebuilds
- commit `cb06256` · builddigest `50cdda7495ea9fdc` · uncommitted files: 7
- cycle time: no closed issues yet
- decision: Patrick at 15:35: skip Tier 3 and rebuild from the spec in Python, PHP, Deno and Rust (Sonnet agents in isolated worktrees, with no access to backends/node-ts). Each records FIRST_RUN (before any fixes) and FINAL_RUN conformance, iterations and elapsed time. Tier 2 on node-ts is running in parallel. Tier 3 moves to 'what I'd do next'.

## 2026-10-26T15:38:11-05:00 · Gate 2: GO (Tier 2, node-ts)
- commit `c0c2c17` · builddigest `e3ac473f3cf0ec81` · uncommitted files: 0
- `evidence/node-ts.tier2.txt` sha256 `d25fc9df782fb226` · ok   archived-is-trash-view [NOTES-FUNC-DEL-3]  45/45 cases passed · ACs: 22 passed, 0 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3001 
- `evidence/falsify.node-ts.txt` sha256 `56f5ff4e436a1486` · CAUGHT restore-keeps-version by NOTES-FUNC-DEL-2 CAUGHT leak-403 by NOTES-SEC-AUTHZ-1 NOTES-SEC-AUTHZ-3 CAUGHT no-trim by NOTES-TECH-FMT-1 
- cycle time: no closed issues yet
- decision: GO. 45/45 cases, 22/22 ACs, 33/33 unit, tsc clean. Falsification: all 5 deliberate faults are caught by the expected ACs, so the suite can fail. Next: merge the rebuilds and run the benchmark.
