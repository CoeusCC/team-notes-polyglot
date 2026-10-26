# Team Notes

[![conformance](https://github.com/CoeusCC/team-notes-polyglot/actions/workflows/conformance.yml/badge.svg)](https://github.com/CoeusCC/team-notes-polyglot/actions/workflows/conformance.yml)

A notes API for small teams. It has one written contract and nine implementations, and all nine pass one shared test suite.
Read the [design choices](#design-choices) below, or run it with the two commands in the next section.
Evidence and the full story are in the [proof ledger](https://coeuscc.github.io/team-notes-polyglot/explainer/proof.html).

## Run it

Requires Node 26 or newer. The reference backend has no runtime dependencies.

```bash
git clone https://github.com/CoeusCC/team-notes-polyglot && cd team-notes-polyglot
cd backends/node-ts && npm install && npm start            # API on http://localhost:3001
```

In a second shell, from the repo root:

```bash
scripts/demo.sh                                            # guided curl walkthrough
(cd conformance && npm install) && node conformance/run.mjs --strict   # all 97 cases
```

The demo users have dev tokens `tok_alice` (owner of team-red), `tok_bob` (member of team-red) and `tok_carol` (owner of team-blue). The other backends start with `backends/<name>/run.sh`. To test every backend, run `scripts/conform-all.sh`.

| Read next | |
|---|---|
| [docs/SERVICE.md](docs/SERVICE.md) | How the API behaves: visibility, concurrent edits, delete and restore, teams, errors |
| [API reference](https://coeuscc.github.io/team-notes-polyglot/api.html) | Rendered from [`spec/openapi.yaml`](spec/openapi.yaml) |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | Every acceptance rule in one table, and how three of them got sharper |
| [START-HERE.md](START-HERE.md) | A guided tour of the repo |

## Design choices

### 1. Write the rules first, then let any language implement them
- **Decision:** the API is defined by an OpenAPI file plus 40 acceptance rules. A person approved each rule, and each one names the test that would prove it false. 97 language-neutral HTTP test cases check those rules against any backend.
- **Gave up:** time spent writing rules before code.
- **Why:** it made rebuilding cheap and checkable. Independent agents rebuilt the service in seven other languages from the rules alone, and each passed the suite on its first run. Where green backends still behaved differently, we tightened the rules ([examples](docs/ACCEPTANCE.md#how-cards-got-sharper)).

### 2. No lost edits, and no leaks between teams
- **Decision:** every note carries a version. An edit must send the version it read (`If-Match`). If someone else saved first, the edit gets 412 instead of overwriting. Anything outside your teams returns the same 404 bytes as something that doesn't exist.
- **Gave up:** a little client convenience: clients must re-read and retry, and they get no "forbidden" hint.
- **Why:** concurrent editing is the main risk in a shared notes app. A test fires 16 edits at once and requires exactly one to win.

### 3. Plain tables and soft delete, not event sourcing
- **Decision:** we store current state with a version column. Delete only marks a note, and restore brings it back.
- **Gave up:** full edit history and an event stream for other systems.
- **Why:** event sourcing would multiply the code and behavior to specify in every language. The upgrade path is an outbox that emits CloudEvents ([ADR-0001](docs/adr/0001-architecture.md)).

The reasoning behind each decision is recorded in [docs/adr/](docs/adr/), with one short "in the context of… we decided… accepting…" statement per decision.

## What I'd change with more time
- **Add:** pagination (the `seq` column is already in place), tags and search, ownership transfer, and real auth (OIDC) instead of seeded tokens.
- **Add:** rate limiting, security headers, and benchmarks for every backend under production servers.
- **Change:** report core rules and environment-specific rules separately in the test runner. Add hidden test cases that implementers never see, to catch overfitting.
- **Stop:** using the Python and PHP development servers for anything except proving the contract.

## Security
- **CORS:** none, on purpose. This is a server-to-server API; a browser client would go through a same-origin gateway or an allow-list.
- **Auth:** seeded dev tokens, stored as SHA-256 hashes. There's no expiry, rotation or signup. Not production auth.
- **Isolation:** team membership is checked in SQL. Tests and a fuzzer confirm that nothing leaks across teams.
- **SQL injection:** every backend uses parameterized queries. An audit found only constant SQL fragments.
- **Input limits:** 2 MiB bodies, valid UTF-8 JSON only, and limits of 200 and 100,000 characters on title and body.
- **Not done:** pagination, rate limiting, security headers, dependency audits, and non-root containers.
- **Known issues:** listed in the [proof ledger](https://coeuscc.github.io/team-notes-polyglot/explainer/proof.html#gaps).

## How it was built
- **Patrick** set the goals, approved every rule and made the design calls. He also overruled the agent where it mattered.
- **Claude Code** wrote the spec and tests and coordinated the work. **Claude Sonnet** agents built the backends.
- **Grok** reviewed adversarially and built three more replications.

Each gate is logged in [`docs/build-digest.md`](docs/build-digest.md). The full chat logs are in [`docs/transcripts/`](docs/transcripts/). MIT licensed.
