# PHP build notes

- Start: 2026-10-26 15:36:14 CDT. End: 2026-10-26 15:39 CDT (about 3 minutes, including reading the spec).
- Conformance iterations: 1. The first run (before any fix) passed 45/45 cases, 22/22 ACs, `--strict`. FINAL_RUN.txt is a second run of the same code.
- Unit tests: `php backends/php/tests/run.php` (16 asserts, domain functions only).

## Spec ambiguities hit (decisions taken)
1. Unknown route or method with no token: answered 401 (auth first), since only `/health` is exempt. Unknown route with a token: 404.
2. "A body is sent" for 415: taken as Content-Length > 0 or a non-empty body. An empty body on POST/PATCH gets 400 (malformed JSON), not 415.
3. Whitespace set for title trim is not specified. Used `\s`, Unicode `\p{Z}` and U+FEFF (close to JS `trim`).
4. DELETE does not change `version` (implied by DEL-2 restore going 1 -> 2); it does not refresh `updatedAt` either. Not pinned down by an AC.
5. Restore refreshes `updatedAt`; the AC only says `version` increments.
6. Error-field name for non-object bodies (null, array, scalar): `(body)`. The ACs only require 422.
7. `If-Match` with a comma list is honoured if any member matches; weak validators (`W/"1"`) are treated as stale (412). Empty `If-Match` is treated as missing (428).
8. `?archived=` values other than `true` behave like `false` (the OpenAPI enum would suggest 422 or 400, but no AC covers it).
9. PATCH ordering: 404 -> 415 -> 413 -> 400 -> 422 -> 428 -> 412, so an invalid body without `If-Match` gets 422 (matches the AC falsifier). A stale `If-Match` with an unchanged note is checked against the row at read time, and the compare-and-set in SQL covers races.

## Suspected defects in spec/cases
- ADR-0002 says Tier 2 cards "still awaiting ratification" while the AC file says ratified. Cosmetic.
- openapi.yaml lists no 412/428 response `ETag` requirement for 428, and does not declare 401/404 on `/health`; fine.
- The `readonly-and-null-bodies` case sends `If-Match` on PATCH, consistent with 422 before 428.
