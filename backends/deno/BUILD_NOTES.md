# Build notes (Deno)

- Start: 2026-10-26 15:36:12 CDT. End: 15:38:34 CDT (about 2.5 min wall clock, including tests and docs).
- Conformance iterations: 1 (first run 45/45 passed, no fixes needed; FINAL_RUN.txt is a re-run of the same code).
- Connection: close on 413 works under Deno.serve (verified with curl).
- Unit tests import `jsr:@std/assert` (std lib, not a third-party dependency; needs network on first run).

## Spec ambiguities hit (decisions made)
1. Invalid `?archived=` values (not `true`/`false`): spec declares no error; treated as false.
2. `If-Match` that is not `*` and not a quoted version (e.g. weak `W/"1"`, garbage): treated as stale, 412.
3. Error `field` name for non-object bodies and empty PATCH `{}`: not specified; used `"(body)"`.
4. 415 trigger: "a body is sent" taken as non-empty body; empty body with no Content-Type falls to 400 (malformed JSON).
5. Restore of a note never requires a body or Content-Type; any body is ignored.
6. PATCH on a soft-deleted note: 404 before any body checks (consistent with DEL-1).
7. Problem `type` URI is unspecified; used `https://teamnotes.example/problems/<status>`. The 404 body carries no `instance`, so it is byte-identical for all causes.
8. Unknown method on a known path: 404 (ADR-0003 "not adopted"), after the 401 check.
