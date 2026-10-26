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

## 2026-10-26T16:10:58-05:00 · Gate Tier 3 + red team
- commit `1259b26` · builddigest `ca75456842c44b28` · uncommitted files: 0
- `evidence/matrix.md` sha256 `e3dde3cafaf16c09` · | NOTES-TECH-FMT-1 | ✅ | ✅ | ✅ | ✅ | ✅ | | NOTES-TECH-FMT-2 | ✅ | ✅ | ✅ | ✅ | ✅ | | **cases passed** | 89/89 | 89/89 | 89/89 | 89/89 | 89/89 | 
- `evidence/redteam.invariants.md` sha256 `cc313d3c67acc41c` ·   - sequence touching the note: `#6 create bob team-red {"title":"\ud800"}` → `#8 restore none note#1 (model deleted=false)` → `#15 patch alice note#1 v1 ifmatch=current:"1" {"body":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`   - repro: `node redteam/invariants.mjs --target node-ts=http://127.0.0.1:3201 --seed 2 --ops 1500`  
- `evidence/redteam.mutation.md` sha256 `ae554736692b8fc1` · ## Not run - `store.ts` / `http.ts` (node-ts), the Rust/PHP/Deno backends: the tool was scoped to the pure cores as asked. The fallback `redteam/mutate.mjs` was not needed because `mutator` ran in under a minute. - Uncovered-site filtering (coverage) was disabled, so the score counts every mutation site. 
- cycle time: 54 closed issues · median 17 min
- decision: Tier 3 (teams) ratified and built in all 5 backends; conform-all at 16:06 gave 5/5 at 89/89, 37/37 ACs (evidence/matrix.md). ERR-5 pinned 403/409 (Patrick: option A; Node and Rust had converged on it independently). Red team (Claude fuzzer, Uncle Bob mutator, Grok probes) found: node-ts 500 on '//', lone surrogates corrupting data (4 behaviors across 5 languages; Patrick: 400 per I-JSON), deno truncating at NUL, and an untested inclusive body limit. These became cards FMT-3 and AUTHN-3 (94 cases). PHP and Rust are already 94/94; fixes for node-ts, deno and python are running. Patrick reports 100 min left at 16:09.

## 2026-10-26T16:52:23-05:00 · Gate 4: FREEZE (16:52)
- commit `a7fecef` · builddigest `fad56828602117e3` · uncommitted files: 0
- `evidence/matrix.md` sha256 `1f79089027d98230` · | NOTES-TECH-FMT-2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | NOTES-TECH-FMT-3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | **cases passed** | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 
- cycle time: 62 closed issues · median 17 min
- decision: All 9 backends (node-ts, deno, bun, python, php, rust, go, java, dotnet) 97/97 cases, 40/40 ACs on one official run. Since Gate 3: Tier 2.1 pins, Tier 3 teams, red-team cards FMT-3/AUTHN-3, AUTHN-4 (Patrick: 'do the ACs still hold?' answered by probe), ERR-5. New rebuilds .NET/Go/Java/Bun: 94/94 on first run (Java 93/94). Runner defects found and fixed along the way: rawBody interpolation, a missing Host header in raw mode, stale-server guard, Docker cleanup. Feature freeze; polish only from here.

## 2026-10-26T17:15:47-05:00 · SUBMISSION (17:18)
- commit `e05387b` · builddigest `e968e78944c9cb11` · uncommitted files: 1
- `evidence/matrix.md` sha256 `8de779a9a2f1a4e5` · | NOTES-TECH-FMT-2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | NOTES-TECH-FMT-3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | **cases passed** | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 97/97 | 
- cycle time: 62 closed issues · median 17 min
- decision: Final official run: all 9 backends (node-ts, deno, bun, python, php, rust, go, java, dotnet) 97/97 cases, 40/40 ACs after the red-team fixes and the history rewrite. A fresh clone of the public repo passes the quickstart, the demo and the suite, with no broken links and 0 privacy matches. CI green for node-ts/deno/python/php/rust. Final red team: no authz, isolation, lost-update or injection defects; 4 protocol findings fixed. History rewritten at Patrick's request to remove employer/personal identifiers; grok/* branches deleted.
