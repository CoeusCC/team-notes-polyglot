# ADR-0001: State-based storage with optimistic concurrency, organized as ports and adapters

- **Status:** Proposed (to be accepted at Gate 1)
- **Date:** 2026-10-26
- **Deciders:** Patrick (human), Claude Code, Grok bots (review)

## Context
We are building the backend for a note-taking service that several small teams share. Teammates edit the same notes, so a silent lost update is the main correctness risk. The brief asks us to defend our tradeoffs and gives us a 180-minute budget. We also want the same behavior from several implementations, possibly in other languages, all checked by one conformance suite. That favors a small, explicit behavior surface.

## Options considered
| Option | Strengths | Weaknesses |
|---|---|---|
| **A. Layered CRUD** (controller → service → table) | Fastest to write, and familiar | Business rules leak into handlers. Nothing structural prevents lost updates. |
| **B. Hexagonal CRUD + optimistic concurrency** (pure domain core, HTTP and storage adapters, `version` column exposed as `ETag`/`If-Match`) | Lost-update protection, a pure core that unit tests easily, small per-language surface, cheap to rebuild elsewhere | No built-in history or audit trail |
| **C. Event sourcing + CQRS on CloudEvents** (append-only `note.*` events, projections) | Full history, audit, replay, integrations | Several times the code in every language: projections, snapshots, eventual-consistency semantics to specify and test. A poor fit for the time budget, and harder to pin down with one black-box suite. |

## Decision
We choose **Option B**.

**Y-statement (architecture):**
> In the context of a team-shared notes service, facing concurrent edits and the need for behavior identical across implementations, we decided for state-based storage with a versioned ETag/If-Match and a domain core behind adapters, and neglected event sourcing/CQRS, to achieve lost-update protection, simple restore semantics, and a small surface one conformance suite can pin down, accepting no full edit history and no event-driven integrations.

**Y-statement (deletion):**
> In the context of shared notes where one member's delete affects the whole team, facing accidental deletion, we decided for soft delete (`deleted_at`) with an idempotent `DELETE` and an explicit restore, and neglected hard delete, to achieve recoverability and safe retries, accepting that storage grows and that a later purge or retention job is needed.

**Y-statement (authorization visibility):**
> In the context of team-scoped notes, facing ID-enumeration by non-members, we decided to answer 404 (not 403) for resources outside the caller's teams, and neglected 403, to achieve no existence leaks, accepting slightly less helpful errors for legitimate misconfigurations.

## Consequences
- Every write checks and increments `version` inside one SQL statement (`UPDATE … WHERE id=? AND version=?`), so concurrent writers cannot both succeed.
- **Upgrade path:** if we need history or integrations, add a transactional outbox table and emit **CloudEvents 1.0** (`com.coeuscc.notes.note.updated.v1`, …) using the official SDKs. That gives most of the benefits of event sourcing without rewriting the write model.
