# Build notes

- Start: 15:36 CDT (2026-10-26). First server running and first conformance run: 15:39. Final green run: 15:40.
- Elapsed: about 4 minutes of wall clock to green (about 6 including docs).
- Conformance iterations: 1 run before any fix (45/45), 1 final confirmation run (45/45). No fixes were needed.
- `cargo test`: 9 unit tests pass (domain and store).

## Spec ambiguities and choices

1. `errors[].field` for a non-object body or an empty PATCH is unspecified; I use `"$"`.
2. Unauthenticated request to an unknown route: I return 401 (auth is first in the precedence), except `GET /health`.
3. `?archived=` values other than `true` are treated as `false`; the OpenAPI enum would imply 422 but no AC says so.
4. DELETE does not bump `version`; only restore of a deleted note does (matches the restore cases: version 2 after restore).
5. A malformed or non-strong `If-Match` (unquoted, `W/"1"`) gets 412, not 428; only missing or `*` gets 428.
6. "A body is sent" for 415 is judged by non-empty bytes; an empty POST/PATCH body gets 400.
7. DELETE on an already-deleted note by a member is 204; by a non-member it is 404.
8. The 413 path drains up to 64 MiB of the remaining body before replying with `Connection: close`, so clients do not see a reset.
9. 422 before 428 means a PATCH with an invalid body and no If-Match gets 422 (as the AC says); a valid body without If-Match gets 428 after the 404 check.

No case contradicted the spec or the ACs.
