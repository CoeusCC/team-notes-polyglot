# Build notes (Python backend)

- Start: 2026-10-26 15:36:18 -05:00 (first read of the spec)
- End: about 15:39 -05:00 (final conformance run saved), roughly 3 minutes of wall clock.
- Conformance iterations: 1 (the first run was already green: 45/45 cases, 22 ACs passed, 0 unverified).
  `FIRST_RUN.txt` and `FINAL_RUN.txt` are both from the same code; no fixes were needed between them.
- Sources read: spec/, conformance/, docs/adr/, AGENTS.md, ub-mode skill. Nothing else under backends/.

## Spec ambiguities hit (decisions made)
1. `?archived=` with a value other than `true` (e.g. `maybe`): the OpenAPI enum implies 422/400, but no response is declared. Treated as the live list.
2. Does DELETE bump `version`? Not stated; DEL-2 (delete then restore gives version 2) implies it does not. Implemented that way.
3. `If-Match` forms beyond `"N"` and `*` (weak `W/"1"`, unquoted, comma lists): unspecified. A list containing `*` gives 428; otherwise it matches if any listed tag equals the current ETag; everything else gives 412.
4. Empty body with `Content-Type: application/json` on POST/PATCH: treated as malformed JSON (400). With no content type and no body, no 415 (no body sent), so 400 as well.
5. Unknown routes and unknown verbs on known paths get the same 404 as hidden notes, but only after authentication (401 first), since the 401 rule says every endpoint except health.
6. Lone surrogates in JSON strings (`"\ud800"`) cannot be stored as UTF-8; reported as 422 on the field. `NaN`/`Infinity` literals are 400.
7. Title trimming uses Python `str.strip()` (Unicode whitespace), which may differ slightly from other languages' `trim`.
8. 413 on a large body: the server answers without reading the body and sends `Connection: close`. `http.server` auto-sends `100 Continue` before that when the client asks for it.
9. 404 for a PATCH on a soft-deleted note comes before body validation, like for non-members.

## Suspected spec/case defects
None blocking. Minor: the OpenAPI declares no 400/422 for the `archived` query parameter (see 1), and `Note.title` has `minLength: 1` but titles are trimmed before that check.
