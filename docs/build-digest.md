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

## 2026-10-26T15:42:40-05:00 · Path B result: 4 rebuilds, all 45/45 on first run
- commit `f748d76` · builddigest `79d56bb1b7b2eb34` · uncommitted files: 4
- `backends/deno/FIRST_RUN.txt` sha256 `f92f6633c2f3205d` · ok   archived-is-trash-view [NOTES-FUNC-DEL-3]  45/45 cases passed · ACs: 22 passed, 0 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3002 
- `backends/python/FIRST_RUN.txt` sha256 `9762944f08009f7b` · ok   archived-is-trash-view [NOTES-FUNC-DEL-3]  45/45 cases passed · ACs: 22 passed, 0 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3004 
- `backends/php/FIRST_RUN.txt` sha256 `b18cf3c83f0cfec9` · ok   archived-is-trash-view [NOTES-FUNC-DEL-3]  45/45 cases passed · ACs: 22 passed, 0 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3003 
- `backends/rust/FIRST_RUN.txt` sha256 `fdad805414bf1b09` · ok   archived-is-trash-view [NOTES-FUNC-DEL-3]  45/45 cases passed · ACs: 22 passed, 0 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3006 
- cycle time: 24 closed issues · median 17 min
- decision: Deno, Python, PHP and Rust each passed 45/45 cases (22/22 ACs, --strict) on their FIRST conformance run, built from the spec alone in 2.5-4 min each, and were re-verified by Claude after merge. 5 implementations green. Divergences the suite doesn't pin are logged in evidence/rebuilds.md and go to Grok's adversarial cases and then Patrick.

## 2026-10-26T15:54:00-05:00 · Tier 2.1: cross-language pins (red first)
- commit `da2f444` · builddigest `b4f4189a600620a8` · uncommitted files: 3
- `evidence/node-ts.pins-red.txt` sha256 `e5101d782b0cce3e` · ok   pin-concurrent-patches-one-wins [NOTES-FUNC-CONC-5]  68/83 cases passed · ACs: 28 passed, 4 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3101 
- `evidence/deno.pins-red.txt` sha256 `c944ea490d8bcbd3` · ok   pin-concurrent-patches-one-wins [NOTES-FUNC-CONC-5]  72/83 cases passed · ACs: 27 passed, 5 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3102 
- `evidence/python.pins-red.txt` sha256 `de6b689ff0a3ab41` · ok   pin-concurrent-patches-one-wins [NOTES-FUNC-CONC-5]  78/83 cases passed · ACs: 30 passed, 2 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3104 
- `evidence/php.pins-red.txt` sha256 `d8416a3d50ce98db` · ok   pin-concurrent-patches-one-wins [NOTES-FUNC-CONC-5]  72/83 cases passed · ACs: 27 passed, 5 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3103 
- `evidence/rust.pins-red.txt` sha256 `920d90d39a50b930` · ok   pin-concurrent-patches-one-wins [NOTES-FUNC-CONC-5]  75/83 cases passed · ACs: 29 passed, 3 refuted, 0 unverified (ratified, no case) · BASE_URL=http://localhost:3106 
- cycle time: 49 closed issues · median 17 min
- decision: Rebuild divergence became 10 core cards and 3 profiles (ADR-0004/0005). HUMAN PUSHBACK: Claude first recommended ignoring stray bodies on restore. Patrick challenged the tradeoff, Claude re-argued it, and the decision flipped to a uniform 415 for any non-JSON body on every operation, one rule that every language implements identically. Red baseline 68-78/83 across the 5 backends; fix agents next.
