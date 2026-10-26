# Red team

Goal: not "the service is perfect", but "under stated conditions it cannot fail in these specific ways", plus evidence that the tests can detect defects.

## Threat model
Attacker is any HTTP client on the wire: unauthenticated, bad token, a legitimate user of the other team (carol vs team-red), or a teammate racing another teammate. Capabilities: arbitrary paths, methods, headers (`If-Match`, `Content-Type`, `Authorization`), bodies (unicode, huge, wrong types, extra/read-only fields, `__proto__`), and parallel requests. Out of scope: network-level attacks, TLS, token theft/guessing, DoS/performance, anything beyond static seeded tokens.

## Invariants ("cannot fail in these ways")
Conditions: one server process, one SQLite file, seeded users (alice/bob on team-red, carol on team-blue), HTTP/1.1, fresh DB.
- **I1** no 5xx for any request sequence.
- **I2** every 4xx is `application/problem+json` with `status` equal to the HTTP status.
- **I3** carol never gets 2xx on a team-red path and never sees a team-red note id in any response body.
- **I4** a note's version never decreases; every 200 PATCH is +1; a 412/428 PATCH leaves stored state untouched (re-GET). Restore of a deleted note is +1, of a live note is +0.
- **I5** no lost update: a PATCH whose If-Match is stale, future, weak, `*`, missing or garbage is never applied. Under concurrency, 16 parallel PATCHes with the same If-Match yield exactly one 200 and fifteen 412, and the final version is v+1.
- **I6** deleted notes are never returned by GET or the live list, and always appear in `?archived=true` for team members until restored.
- **I7** `ETag == "<body.version>"` on every note response.
- **I8** no 2xx without a valid token, except `/health`.
- **M** (model agreement): expected status per ADR-0003 precedence (401, 404, 415, 413, 400/422, 428, 412), trimmed titles, list contents versus the fuzzer's own model.

"Checked" means evaluated after every response in a random sequence (seeded mulberry32 PRNG; the seed and request lines are printed) plus a deterministic probe sweep of ~40 hostile paths x 6 methods x 3 callers per run. This is evidence by search, not a proof: absence of violations over N ops is not exhaustive.

## Run
```
redteam/run-all.sh 1,2 1500            # starts all 5 backends (ports 3201-3206, fresh DB, own process group), fuzzes, stops them
redteam/run-all.sh 1,2 1500 python     # one backend
node redteam/invariants.mjs --target node-ts=http://127.0.0.1:3201 --seed 7 --ops 2000   # against any running server
```
Output: `evidence/redteam.invariants.{json,md}`. Exit 1 if any violation. The "sequence touching the note" printed per violation is the slice of the log that touched that note (a causal slice, not an automatically delta-debugged minimum). Repro = same seed against a fresh server.

Mutation testing: see `evidence/redteam.mutation.md` (Uncle Bob's `mutator`, run on scratch copies).

## Judgement calls built into the oracle
Behaviours the spec does not pin are treated as "invariants only": duplicate or case-variant `archived` query params, `?archived=` (empty), an If-Match list that contains the current ETag, duplicate JSON keys, lone surrogates, `HEAD`/`OPTIONS`, junk team ids in the URL. Observed divergence between backends on these is reported, not failed.

## Not proven
- Performance or behaviour under real network conditions (slow clients, resets, keep-alive reuse, proxies, HTTP/2). Only loopback HTTP/1.1, one connection per request.
- Multi-process or multi-host SQLite on every runtime (the burst test is 16 in-flight requests to a single server process; PHP's built-in server and the others were not tested with several workers on one file).
- Auth beyond the three static tokens: no token rotation, expiry, membership changes (Tier 3), or timing side channels.
- Tier 3 (teams, tags, search, paging) is not modelled.
- The mutation run covers only the pure domain cores with unit tests, not `store`/`http` layers or the Rust/PHP/Deno backends.
