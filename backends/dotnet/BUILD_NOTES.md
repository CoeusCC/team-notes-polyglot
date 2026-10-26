# Build notes: .NET 9 rebuild from spec

- Inputs used: spec/, conformance/, docs/adr/, AGENTS.md. No other backend was read.
- Started about 16:17 CDT, first Docker build succeeded after 2 compile fixes (about 16:20), first conformance run at 16:20:44.
- First run (before any fix): 94/94 cases, 39 ACs passed, 0 refuted, 0 unverified (FIRST_RUN.txt). Iterations to green: 0 behavioral fixes (2 compile-error fixes before the first run). FINAL_RUN.txt: 94/94.
- Wall-clock: roughly 4 minutes from first spec read to 94/94 (including docker image pulls and 3 builds).
- Unit tests: not written (time box).
- Spec ambiguities / choices: empty `If-Match` value treated as missing (428); `/health` with non-GET and no token gets 401; GET with a non-empty non-JSON body gets 415 (uniform rule); member roster ordered owner first then by id; `type` of problems is `about:blank`; duplicate JSON keys are not rejected.
- Gotchas: Unicode escapes in source got mangled by file writing, so White_Space is expressed with numeric code points.
