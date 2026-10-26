# Team Notes, built spec-first

This is a REST backend for a note-taking service shared among small teams. Every note belongs to one team, and every member of that team can read and edit it. Non-members can't tell that the note exists.

It is built **spec-first**:
- an OpenAPI contract ([`spec/openapi.yaml`](spec/openapi.yaml))
- acceptance criteria written as falsifiable cards ([`spec/acceptance-criteria.md`](spec/acceptance-criteria.md))
- a language-neutral conformance suite ([`conformance/`](conformance/)) that any backend must pass

It is delivered in **gated tiers** ([`docs/PLAN.md`](docs/PLAN.md)), so there is always a working, demoable service before more ambitious work starts. Progress and evidence are logged in [`docs/build-digest.md`](docs/build-digest.md).

## Quickstart

Requires **Node ≥ 26**, which provides built-in `node:sqlite` and TypeScript type stripping. The backend has no runtime dependencies.

```bash
git clone https://github.com/CoeusCC/team-notes-polyglot && cd team-notes-polyglot

# run the reference backend (in-memory DB; set DB_PATH=notes.db to persist)
cd backends/node-ts && npm install && npm start          # → http://localhost:3001

# in another shell, from the repo root:
scripts/demo.sh                                          # guided curl walkthrough
(cd conformance && npm install) && node conformance/run.mjs   # 27 cases, one per AC falsifier
(cd backends/node-ts && npm test && npm run typecheck)   # unit tests + tsc
```

Seed users (dev tokens only):

| User | Token | Teams |
|---|---|---|
| alice | `tok_alice` | team-red (owner) |
| bob | `tok_bob` | team-red (member) |
| carol | `tok_carol` | team-blue (owner) |

```bash
curl -H 'Authorization: Bearer tok_alice' -H 'content-type: application/json' \
     -d '{"title":"Sprint goals","body":"Ship it"}' localhost:3001/teams/team-red/notes
```

## API (Tier 1)
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | no auth |
| GET | `/me` | the caller and their teams |
| GET | `/teams` | the caller's teams |
| GET/POST | `/teams/{teamId}/notes` | list (newest first), create (201 + `Location`) |
| GET/PATCH/DELETE | `/notes/{noteId}` | read, partial update (`version`++), delete |

- **Errors** are RFC 9457 `application/problem+json`: 400 for bad JSON, 401 for no or invalid token, 404 for not found *or not yours*, and 422 for validation failures (with `errors[]`).

## Layout
```
spec/            openapi.yaml · acceptance-criteria.md · schema.sql (shared by every backend)
conformance/     cases.json (data-only HTTP cases) · run.mjs (runner + OpenAPI response validation)
backends/node-ts reference implementation: src/domain (pure) · store.ts (SQLite) · http.ts
docs/            PLAN.md · adr/ · build-digest.md · handoff/
scripts/         demo.sh · digest.sh · bot-bus/
```

## Design choices
*(A full write-up comes at the final gate. Summary so far.)*
1. **Spec, then ACs, then data-only conformance before code.** A backend is "done" when an independent suite says so. That makes it cheap to rebuild the service in another language.
2. **404, not 403, for anything outside your teams.** This avoids leaking which notes exist. See [ADR-0001](docs/adr/0001-architecture.md).
3. **No event sourcing.** We use state-based storage with a `version` column, which becomes an ETag and `If-Match` in Tier 2, and a pure domain core behind adapters. The reasoning is recorded as Y-statements in [ADR-0001](docs/adr/0001-architecture.md).

## What I'd change with more time
*(Filled in at the final gate.)*
