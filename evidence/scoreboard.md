# Scoreboard

Generated 2026-10-26T20:57:29.341Z · sha `6907322` (dirty) · builddigest `2b7ef9085aab5806` · quick run · "harness smoke test 2"

History: `evidence/history.jsonl` (2 rows). Re-run: `node harness/scoreboard.mjs [--quick] [--backends a,b] --label "..."`

## Latest

| metric | node-ts | python |
|---|---|---|
| cases passed | 68/83 | 83/83 |
| ACs passed / refuted / unverified | 28 / 4 / 0 | 32 / 0 / 0 |
| refuted ACs | NOTES-FUNC-CONC-4, NOTES-FUNC-DEL-4, NOTES-TECH-ERR-3, NOTES-SEC-AUTHN-2 | none |
| bench score | 100.0 | 15.2 |
| gate failures | none | none |
| lost updates / leaks | 0 / 0 | 0 / 0 |
| read p99 ms · req/s | 6.7 · 19407 | 45.9 · 796 |
| list p99 ms · req/s | 9.1 · 8199 | 49.7 · 2914 |
| mixed p99 ms · req/s | 9.0 · 12211 | 45.0 · 787 |
| contention p99 ms · req/s | 8.8 · 10798 | 48.3 · 792 |
| authz-under-load p99 ms · req/s | 7.8 · 16560 | 45.8 · 810 |
| write p99 ms · req/s | 9.0 · 10796 | 47.6 · 786 |
| red-team invariant violations | 56 | 45 |

**Falsification (node-ts):** 5 caught / 0 missed

**Mutation testing:** not present

## Trend (last 2 rows; Δ vs previous row)

| ts | sha | label | node-ts score | node-ts cases | python score | python cases |
|---|---|---|---|---|---|---|
| 2026-10-26T20:56:23 | da52fe0* | harness smoke test [quick] | 100.0 | 68/83 | 13.2 | 46/83 |
| 2026-10-26T20:57:29 | 6907322* | harness smoke test 2 [quick] | 100.0 (±0) | 68/83 (±0) | 15.2 (+2.1) | 83/83 (+37) |

Note: bench scores are relative within a run (best backend = 100 per KPI), so compare scores only between runs with the same backend set and mode.

## Improvement queue

Ranked: 1 refuted AC · 2 missed fault · 3 invariant violation · 4 surviving mutant · 5 ratified AC with <2 cases · 6 bench gate · 7 slowest p99 · 8 score <50% of leader.

1. **[P1]** Fix backends/node-ts: make NOTES-FUNC-CONC-4 pass (write/confirm the failing case first)
   - evidence: node-ts refutes NOTES-FUNC-CONC-4; failing cases: pin-ifmatch-list-contains-current, pin-ifmatch-list-with-star, pin-ifmatch-opaque-string. Repro: BASE_URL=... node conformance/run.mjs --only <case>
2. **[P1]** Fix backends/node-ts: make NOTES-FUNC-DEL-4 pass (write/confirm the failing case first)
   - evidence: node-ts refutes NOTES-FUNC-DEL-4; failing cases: pin-archived-yes, pin-archived-1, pin-archived-empty, pin-archived-TRUE. Repro: BASE_URL=... node conformance/run.mjs --only <case>
3. **[P1]** Fix backends/node-ts: make NOTES-TECH-ERR-3 pass (write/confirm the failing case first)
   - evidence: node-ts refutes NOTES-TECH-ERR-3; failing cases: pin-empty-body-no-ct, pin-empty-body-text-plain, pin-empty-patch-no-ct, pin-415-any-nonjson-body. Repro: BASE_URL=... node conformance/run.mjs --only <case>
4. **[P1]** Fix backends/node-ts: make NOTES-SEC-AUTHN-2 pass (write/confirm the failing case first)
   - evidence: node-ts refutes NOTES-SEC-AUTHN-2; failing cases: pin-unknown-route-no-token, pin-unknown-verb-no-token, pin-malformed-escape-404, pin-trailing-slash-404. Repro: BASE_URL=... node conformance/run.mjs --only <case>
5. **[P3]** Fix backends/node-ts for red-team invariant I1 (56 violations)
   - evidence: evidence/redteam.invariants.md; e.g. hdr DELETE /notes/%E0 If-Match:* -> status 500: {"type":"https://teamnotes.example/problems/internal","title":"Inter
6. **[P3]** Fix backends/deno for red-team invariant M (46 violations)
   - evidence: evidence/redteam.invariants.md; e.g. carol GET /teams/team-blue/notes?archived= -> expected 200 items, got 422
7. **[P3]** Fix backends/php for red-team invariant M (45 violations)
   - evidence: evidence/redteam.invariants.md; e.g. carol GET /teams/team-blue/notes?archived= -> expected 200 items, got 422
8. **[P3]** Fix backends/python for red-team invariant M (45 violations)
   - evidence: evidence/redteam.invariants.md; e.g. carol GET /teams/team-blue/notes?archived= -> expected 200 items, got 422
9. **[P3]** Fix backends/rust for red-team invariant M (45 violations)
   - evidence: evidence/redteam.invariants.md; e.g. carol GET /teams/team-blue/notes?archived= -> expected 200 items, got 422
10. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-ME-1
   - evidence: ratified AC has 1 case(s); need >= 2
11. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-NOTE-2
   - evidence: ratified AC has 1 case(s); need >= 2
12. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-NOTE-3
   - evidence: ratified AC has 1 case(s); need >= 2
13. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-NOTE-4
   - evidence: ratified AC has 1 case(s); need >= 2
14. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-TECH-CONTRACT-1
   - evidence: ratified AC has 1 case(s); need >= 2
15. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-SEC-AUTHZ-3
   - evidence: ratified AC has 1 case(s); need >= 2
16. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-VALID-2
   - evidence: ratified AC has 1 case(s); need >= 2
17. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-CONC-1
   - evidence: ratified AC has 1 case(s); need >= 2
18. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-CONC-2
   - evidence: ratified AC has 1 case(s); need >= 2
19. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-CONC-3
   - evidence: ratified AC has 1 case(s); need >= 2
20. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-DEL-1
   - evidence: ratified AC has 1 case(s); need >= 2
21. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-DEL-2
   - evidence: ratified AC has 1 case(s); need >= 2
22. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-DEL-3
   - evidence: ratified AC has 1 case(s); need >= 2
23. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-FUNC-CONC-5
   - evidence: ratified AC has 1 case(s); need >= 2
24. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-TECH-ERR-4
   - evidence: ratified AC has 1 case(s); need >= 2
25. **[P5]** Add 1 case(s) to conformance/cases.json for NOTES-SEC-AUTHZ-4
   - evidence: ratified AC has 1 case(s); need >= 2
26. **[P7]** Profile backends/node-ts scenario "list" (slowest p99)
   - evidence: p99 9.1 ms, 8199 req/s
27. **[P7]** Profile backends/python scenario "list" (slowest p99)
   - evidence: p99 49.7 ms, 2914 req/s
28. **[P8]** Raise backends/python performance (score under 50% of leader)
   - evidence: score 15.2 vs leader 100.0
