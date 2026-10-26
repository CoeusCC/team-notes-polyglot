# Team Notes, one spec and five implementations

This is a REST backend for a note-taking service shared among small teams:
- Every note belongs to one team, and every member of that team can read and edit it.
- Teams manage their own membership. Outsiders can't tell that a note or team exists.
- Concurrent edits can't silently overwrite each other.

The project is built **spec-first**, so the same service exists as **five independent implementations** (Node/TS, Deno, Python, PHP, Rust). All five pass one language-neutral conformance suite:

| Artifact | What it is |
|---|---|
| [`spec/openapi.yaml`](spec/openapi.yaml) | The OpenAPI 3.1 contract |
| [`spec/acceptance-criteria.md`](spec/acceptance-criteria.md) | 36 ratified acceptance criteria (ACs), each with a **Falsifier** |
| [`conformance/cases.json`](conformance/cases.json) | 88 data-only HTTP cases, each tagged with the AC it would refute |
| [`docs/adr/`](docs/adr/) | Six architecture decision records with Y-statements |
| [`docs/build-digest.md`](docs/build-digest.md) | Append-only log of every gate: commit, builddigest, evidence hashes, decisions |
| [`evidence/`](evidence/) | Conformance runs, falsification, rebuild results, benchmarks, red team, scoreboard |

## Quickstart

You need **Node ≥ 26**, which provides `node:sqlite` and TypeScript type stripping. The reference backend has no runtime dependencies.

```bash
git clone https://github.com/CoeusCC/team-notes-polyglot && cd team-notes-polyglot
(cd conformance && npm install)                          # runner deps: ajv, yaml

cd backends/node-ts && npm install && npm start          # → http://localhost:3001 (DB_PATH=notes.db to persist)
# second shell, from the repo root:
scripts/demo.sh                                          # guided curl walkthrough
node conformance/run.mjs --strict                        # 88 cases against BASE_URL (default :3001)
```

To run any other backend: `PORT=3002 DB_PATH=/tmp/n.db backends/<deno|python|php|rust>/run.sh`. For all of them in Docker with identical limits (1 CPU / 512 MB each): `bench/run-docker.sh`.

The seed users have dev tokens only: `tok_alice` (owner of team-red), `tok_bob` (member of team-red) and `tok_carol` (owner of team-blue).

```bash
curl -H 'Authorization: Bearer tok_alice' -H 'content-type: application/json' \
     -d '{"title":"Sprint goals","body":"Ship it"}' localhost:3001/teams/team-red/notes
```

## API
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | no auth |
| GET | `/me` | the caller and their teams |
| GET / POST | `/teams` | my teams / create a team (client slug id; the creator becomes owner) |
| GET | `/teams/{teamId}` | the team, with the caller's role |
| GET | `/teams/{teamId}/members` | the roster |
| PUT / DELETE | `/teams/{teamId}/members/{userId}` | owner only; idempotent; the last owner can't be removed |
| GET / POST | `/teams/{teamId}/notes` | live notes, newest first (`?archived=true` is the trash view) / create |
| GET / PATCH / DELETE | `/notes/{noteId}` | `ETag: "<version>"`; PATCH **requires** `If-Match`; DELETE is a soft delete |
| POST | `/notes/{noteId}/restore` | undo a delete (the version goes up by one) |

**Errors** are RFC 9457 `application/problem+json`. When a request has several problems, this order decides which one is reported: **401 → 404 → 415 → 413 → 400 → 422 → 428 → 412**.

## Design choices I spent the most time on

### 1. Spec, then ACs, then falsifiers, then code, delivered in gated tiers
The OpenAPI contract says *what* the API looks like. The ACs say *what must be true*, and each card names the test that would prove it false. `cases.json` turns those falsifiers into data that any HTTP implementation can run.
- **Tiers and gates:** we delivered in tiers (MVP → concurrency/soft delete → cross-language pins → teams). Each tier passed a gate with a recorded go/no-go decision, so the service was always submittable.
- **The payoff:** independent agents rebuilt the service in **Deno, Python, PHP and Rust from the spec alone**, with no access to the reference code. **All four passed 45/45 on their first conformance run**, each in 2.5–4 minutes ([`evidence/rebuilds.md`](evidence/rebuilds.md)). A second model family (Grok) built three more replications, and they also passed 45/45.
- **The surprise was the most useful finding:** the green rebuilds still **diverged** on behavior the suite didn't pin down (weak or list `If-Match`, junk `?archived=`, empty bodies, whitespace sets). We turned each divergence into a ratified core card (ADR-0005), and split environment-specific rules into **profiles** (ADR-0004). Cross-language disagreement became a way to measure how complete the spec is.

### 2. Lost-update protection and visibility that leaks nothing
- **Optimistic concurrency:** `version` is exposed as a strong ETag. PATCH *requires* `If-Match` (428 without it, 412 when stale), and the check-and-increment is a single conditional `UPDATE … WHERE version = ?`. A parallel conformance case fires 16 simultaneous PATCHes and requires exactly one to win. The benchmark's contention scenario shows **0 lost updates** on every backend.
- **No existence leaks:** anything outside your teams returns a **byte-identical 404**, never 403. That covers missing ids, hidden ids, malformed ids, deleted notes and unknown routes. The one exception is a team member who isn't the owner, who gets 403 on membership changes, because they can already see the team (ADR-0006).

### 3. No event sourcing: state plus `version`, behind a pure domain core
Event sourcing with CQRS on CloudEvents would give history and integrations. But it multiplies the code and the semantics we would have to specify in every language. We chose state-based storage with a version column and soft delete (ADR-0001/0002). The upgrade path is a transactional outbox emitting CloudEvents. Each backend keeps the domain rules in a pure module, separate from its SQL and HTTP adapters.

## Proof, not just tests
| Check | What it shows | Where |
|---|---|---|
| Conformance (88 cases, 36 ACs) | Every backend meets every ratified card. `--strict` fails on any AC without a case | `conformance/`, `evidence/matrix.md` |
| Red first | Each tier's cases were committed failing before the code existed | `evidence/*-red.txt` |
| Falsification | 5 deliberate faults (lost update, hard delete, 403 leak, …) all **caught** by the expected ACs | `scripts/falsify.sh`, `evidence/falsify.node-ts.txt` |
| Cross-model replication | 4 Claude and 3 Grok rebuilds, all green, built only from the spec | `evidence/rebuilds.md` |
| Red team | Stateful property-based fuzzer (no 5xx, no leaks, monotonic versions, no lost updates under concurrency) and mutation testing | `redteam/`, `evidence/redteam.*` |
| Benchmarks | Throughput and p50/p95/p99 per scenario, mean ± stddev over runs, with correctness gates that zero a score | `bench/`, `evidence/bench.*` |
| Scoreboard loop | One command appends a history row, shows trends, and ranks the next improvements | `harness/`, `evidence/scoreboard.md` |
| Separation of duties | Implementers never recorded verdicts. The runner's output is the verdict, and Patrick ratified every AC | `AGENTS.md`, `docs/build-digest.md` |

## How it was built
- **Patrick:** set the goals, ratified every AC, and made every architectural call through recorded question cards. He also pushed back where it mattered, for example the uniform 415.
- **Claude Code (Opus):** orchestrated, wrote the spec and cases, reviewed and merged.
- **Claude Sonnet agents:** implemented each backend in isolated worktrees.
- **Grok (Speck):** reviewed adversarially, drafted adversarial cases, and built the replications.

Coordination happened in GitHub Discussions (#1 "Plan & gates" and #2 "Bot bus") and on the Project board. Transcripts are in [`docs/transcripts/`](docs/transcripts/).

## What I'd change, add, or stop doing with more time
- **Add:**
  - Tags, full-text search and keyset pagination. These were cut at Gate 3 in favor of proving the spec approach.
  - Ownership transfer and multiple owners.
  - A CloudEvents outbox for history and integrations.
  - Real auth (OIDC/JWT) instead of seeded tokens.
- **Change:**
  - Have the runner report **core and profile** verdicts separately, with each backend declaring its profiles.
  - Add **held-out cases** that agents never see, to measure overfitting to the visible suite.
  - Keep growing the divergence → card loop automatically from the scoreboard queue.
- **Stop:** running the PHP built-in server and Python's `http.server` for anything beyond demos. They're great for proving the contract, but a production deployment needs a real server (FrankenPHP or RoadRunner; uvicorn or gunicorn).
- **Caveats:**
  - SQLite serializes writes, which is fine for small teams but not for a fleet.
  - Benchmarks run on a single machine.
  - The tokens are dev-only.
