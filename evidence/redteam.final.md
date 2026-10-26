# Red team — final report (Team Notes, all 9 backends)

- **Date:** 2026-10-26, hard stop 17:12 CDT.
- **Scope:** node-ts, deno, python, rust, php, go, java, dotnet, bun — fresh DBs on ports 3501–3509.
- **Method:** no-dep Node 26 harness in `scratchpad/rt-final/` (`attack.mjs`, `race.mjs`, `head.mjs`, `malpath.mjs`, `depth.mjs`, `probe.mjs`), the ratified invariant fuzzer `redteam/invariants.mjs --seed 7 --ops 1500` against all 9 at once, and the proposed Tier-3 race cases `conformance/proposed/tier3-redteam.json` run via a scratch copy of the conformance runner.
- **Rule applied:** only reproduced defects are reported; known gaps in the README are not re-reported.
- Raw logs: `redteam.final.invariants.{md,json}`, `redteam.final.head.log`, `redteam.final.java-head-hang.log`, `redteam.final.malpath.log`, `redteam.final.depth.log`, `redteam.final.race.log`, `redteam.final.attack.log`, `redteam.final.pathprobe.log`.

Headline: **no authorization, tenant-isolation, lost-update, or injection defect was found on any backend.** The four reproduced findings are all HTTP-protocol / error-contract robustness bugs (not data exposure or privilege escalation), each isolated to 1–2 backends.

---

## Findings (ranked)

### F1 — java: HEAD responses carry a message body (MEDIUM-HIGH)
- **Backends:** java only.
- **Card(s) violated:** RFC 9110 §9.3.2 (HEAD MUST NOT return a body); surfaces as invariant **I1** ("no 5xx / no transport failure") in the fuzzer — 36/2814 requests per seed-7 run, every one a HEAD.
- **Repro (raw socket):**
  ```
  printf 'HEAD /notes/00000000-0000-0000-0000-000000000000 HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer tok_alice\r\nConnection: close\r\n\r\n' | nc 127.0.0.1 3507
  ```
  Response: `404`, `Content-Length: 55`, **then 55 bytes of body** `{"type":"about:blank","title":"Not Found","status":404}`. All other backends send headers only (0 bytes after the header block). See `redteam.final.head.log`.
- **Expected:** a HEAD response has the same status/headers as GET but **no body**.
- **Actual:** java writes the full problem+json body. On loopback with `Connection: close` it is merely wrong; over HTTP/1.1 keep-alive or through a proxy the body bytes are parsed as the start of the next response → stream desync (the fuzzer's "Parse Error: Expected HTTP/"). Reproduces on every HEAD, authed or not. Also note the HEAD 404 body differs from the ratified GET 404 body.

### F2 — node-ts & bun: deeply nested JSON → 500 (MEDIUM)
- **Backends:** node-ts (depth ≳5000), bun (depth ≈100000).
- **Card(s) violated:** invariant **I1** (no 5xx); NOTES-FUNC-VALID-1 (malformed/invalid JSON must be 400/422, never 500).
- **Repro:**
  ```
  node -e 'process.stdout.write("{\"title\":\"t\",\"body\":"+"[".repeat(5000)+"1"+"]".repeat(5000)+"}")' \
    | curl -s -XPOST http://127.0.0.1:3501/teams/team-red/notes -H 'Authorization: Bearer tok_alice' -H 'content-type: application/json' --data-binary @-
  ```
  → `500 {"type":".../internal","title":"Internal Server Error","status":500}`.
- **Expected:** 422 (body must be a string) or 400. Every other backend returns 400/422 at all depths (see `redteam.final.depth.log`): deno/rust/php/java/dotnet → 400; python/go → 422 then 400 at extreme depth.
- **Actual:** a `RangeError`/stack overflow in recursive JSON parsing/validation escapes to a 500. Body is still valid problem+json and the process stays up (health OK afterwards), so it is a robustness/DoS-lite issue, not a crash. A few KB of brackets triggers it.

### F3 — go: malformed `%`-escape path returns 400 text/plain, bypassing the 401 contract (MEDIUM)
- **Backends:** go only.
- **Card(s) violated:** NOTES-SEC-AUTHN-1 (no token, non-`/health` → 401), NOTES-SEC-AUTHN-3 (malformed path → 401 unauth / identical 404 authed, never a bare 400), NOTES-TECH-ERR-1 (4xx must be `application/problem+json`).
- **Repro:** `curl -s -i http://127.0.0.1:3506/%E0%A4%A` (no token) → `400` `Content-Type: text/plain; charset=utf-8`, framework body — **not 401**. Same for `/%`, `/%zz`. Authed → also 400 text/plain. See `redteam.final.malpath.log`.
- **Expected:** `401` (no token) / problem+json `404` (authed), as all other backends do.
- **Actual:** Go's `net/http` rejects the structurally-invalid percent-escape before auth/routing. Valid-but-odd escapes (`%00`, `%ff`, `%E0`) are handled correctly. No 5xx. Impact: an unauthenticated client gets a non-401 that fingerprints the runtime and breaks the uniform error contract; no data exposure or escalation.

### F4 — dotnet: encoded NUL (`%00`) in path returns 400 empty body, bypassing the 401 contract (MEDIUM)
- **Backends:** dotnet only.
- **Card(s) violated:** same as F3 (AUTHN-1, AUTHN-3, ERR-1); shows up as fuzzer **M** "expected 401/404 got 400".
- **Repro:** `curl -s -i 'http://127.0.0.1:3508/notes/%00'` (no token) → `400`, empty body, no `Content-Type` — **not 401**. Also `/%00`, `/teams/%00/notes`, `/notes/x%00y`. `%ff` and `%00` in the query string are fine. See `redteam.final.malpath.log`.
- **Expected:** `401` (no token) / problem+json `404` (authed).
- **Actual:** Kestrel rejects a NUL in the decoded path before the pipeline runs. No 5xx. Same limited impact as F3.

---

## What held (counts) — strong negative evidence

All of the below reproduced the *correct* behavior on **all 9 backends**.

- **Authorization / privilege escalation** (`attack.mjs`, 0 fails on all 9):
  - bob (member) PUT/DELETE on team-red membership → 403; alice stays owner.
  - bob cannot escalate his own role (PUT is member-only).
  - carol (non-member / owner of team-blue) on 11 team-red routes (notes list/create, archived list, GET team, members, PUT/DELETE member, GET/PATCH/DELETE/restore note) → **404 every time**; no team-red note id ever appears in a carol response.
- **Team-id collision:** exact `team-red` re-create → 409 and carol still 404; `Team-Red`, ` team-red`, `team-red `, Unicode hyphen, fullwidth → 422; no access granted. (9/9)
- **Tenant isolation:** 404 bodies byte-identical across other-team note / random UUID / malformed id (9/9); note id used in a members path → 422.
- **Concurrency / integrity:**
  - Proposed Tier-3 race cases (re-add, removed-member-cannot-write, 4×DELETE + 8×PATCH race): **4/4 pass on all 9**.
  - Custom race (remove bob while 20 parallel PATCHes in flight, then 10 more + POST + DELETE post-removal): **0 strict violations on all 9**. Once DELETE returned 204, no later bob write succeeded; concurrent phase allowed exactly one 200 where a write linearized first; final version matched. See `redteam.final.race.log`.
  - Fuzzer seed 7, ~2814 req/backend: **I3 (cross-team leak) 0, I4/I5/I6/I7/I8 0 on all 9**; 16-way bursts exactly-one-winner **12/12 on all 9**. Only non-zero: go I2 (=F3), dotnet I2/M (=F4), java I1 (=F1). node-ts/deno/python/rust/php/bun: **0 violations across all invariants**.
- **Injection / parsing** (9/9): SQL metacharacters (`' OR 1=1--`, `'; DROP TABLE notes;--`, `%27`) round-trip exactly and the notes table stays intact; NUL in title and body round-trips; lone surrogates (`\ud800`, `x\udfff`) and raw `FF FE` bytes → 400; `__proto__`/`constructor` → 422 (no prototype pollution); huge number in a read-only field → 422; duplicate JSON keys and BOM → no 5xx.
- **Header tricks** (9/9): two `Authorization` headers → 401; empty bearer token → 401; `/teams/team%2Dred/notes` → 200 (decoded == team-red); 20 KB header value → no crash.
- **Availability** (9/9): body of exactly 100000 cp → 201, 100001 → 422; 1 MiB title → 422 in <5 s; >2 MiB body → 413 in <5 s; slowloris partial body did not block `/health`; 50 ghost-member adds → 422 with roster unchanged; all backends healthy at end.
