# Build digest

This is an append-only log, with one entry per gate and per significant commit. `builddigest` is the sha256 (shortened) of `git ls-tree -r HEAD`, following `SpecDLC-Research/specs/verdict-runner.md`. Mechanical fields come from `scripts/digest.sh`. The decision lines are written by hand.

The session started at 2026-10-26T15:11 CDT, with a 180-minute budget, so the deadline is about 18:11 CDT.


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
