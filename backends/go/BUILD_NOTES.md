# Build notes: Go rebuild from spec

- Started 16:17 CDT; first complete build and conformance run finished 16:21 CDT (about 5 minutes wall clock, including about 1.5 minutes of Docker image builds and module downloads).
- First run: 94/94 cases, 39 ACs passed (FIRST_RUN.txt). No fixes were needed, so iterations to green: 0 (1 run). FINAL_RUN.txt is the same result.
- One build failure before the first run: a literal U+FEFF in a unit test file (compile error, not a behavior issue).
- Design: single `ServeHTTP`; auth first (401), hand-rolled path routing (identical constant 404), then per-handler order 404 -> 403 -> 415 -> 413 -> 400 -> 422 -> 409 -> 428 -> 412.
- Validation: own I-JSON check (utf8.Valid plus a surrogate-escape scanner) before `encoding/json`; `unicode.IsSpace` trimming matches Unicode White_Space; lengths by `utf8.RuneCountInString`.
- Concurrency: one connection, and PATCH is `UPDATE ... WHERE id=? AND version=?`.
- Spec ambiguities: (1) an empty or blank `If-Match` value is unspecified (we treat a present non-matching value as 412); (2) oversized body on a body-ignoring op (restore/DELETE) gets 413 by our reading; (3) roster ordering is unspecified (owner first, then by id); (4) `%zz` bad escapes are rejected by Go's HTTP server with its own 400 before the handler runs, which this design can't change without a custom listener.
