# ADR-0002: Concurrency and deletion semantics (Tier 2)

- **Status:** Accepted (decided by Patrick on 2026-10-26; Tier 2 cards ratified the same day)
- **Builds on:** [ADR-0001](0001-architecture.md), which chose state-based storage with `version`, ETag and `If-Match`
- **Cards:** NOTES-FUNC-CONC-2, NOTES-FUNC-CONC-3, NOTES-FUNC-DEL-2, NOTES-FUNC-DEL-3

## Decision 1: `If-Match: *` is rejected with 428
> In the context of team-shared notes where several members edit the same note, facing the risk that a client sends `If-Match: *` (which RFC 9110 defines as "matches any current representation"), we decided to treat `*` like a missing precondition and answer `428 Precondition Required`, and neglected honoring `*` as an unconditional overwrite or answering 412, to achieve a guarantee that every successful update was made against the exact version the writer saw, accepting a small deviation from the RFC wildcard semantics and no "force overwrite" escape hatch (a client must re-read and retry).

## Decision 2: restore increments `version`
> In the context of soft delete with restore, facing a writer who still holds an ETag from before the note was deleted, we decided that restore is a state change that increments `version` (a no-op restore of a live note does not), and neglected keeping the pre-delete version, to achieve the rule "any state change invalidates old ETags", so stale writers get 412 instead of silently editing a resurrected note, accepting one extra re-read for clients after a restore.

## Decision 3: `?archived=true` is a trash view that lists only deleted notes
> In the context of listing team notes, facing the need to find deleted notes so they can be restored, we decided that `?archived=true` returns only deleted notes, each carrying an optional `deletedAt` that is absent on live notes, and neglected an "include deleted" mixed view, to achieve two simple, disjoint lists (live and trash) that clients don't need to filter, accepting that a combined view needs two requests.

## Consequences
- `Note` gains an optional `deletedAt` field (date-time).
- The PATCH steps in the Tier 1 cases gain `If-Match` once the Tier 2 cards are ratified.
- Falsification faults for Tier 2: `FAULT=ignore-if-match` (lost update), `FAULT=hard-delete`, `FAULT=restore-keeps-version`. Each must turn the suite red on the matching card.
