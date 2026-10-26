# Build notes: Java rebuild from spec

Working only from `spec/`, `conformance/`, `docs/adr/`, AGENTS.md.

## Timing (wall clock, 2026-10-26 CDT)
- Start 16:17, spec read and first full code written about 16:18-16:19 (~2 min of authoring after reading).
- First Docker build 16:19 (one compile error: `List.of(String[])` varargs ambiguity, fixed; build ~1 min cold, ~25 s warm).
- **First conformance run (before any fix): 93/94** at 16:21 (`FIRST_RUN.txt`).
- Fix + rebuild + rerun: **94/94** at 16:22 (`FINAL_RUN.txt`). Total about 6 minutes from start to 94/94; 1 fix iteration after the first run (plus 1 compile-error iteration before it).

## The one conformance failure and its fix
`redteam-double-slash-no-5xx` (NOTES-SEC-AUTHN-3): the JDK `com.sun.net.httpserver.HttpServer` parses the request target
with `java.net.URI` and answers `400 Bad request URI` itself for `//` (empty authority), before any handler runs. No hook exists.
Fix: replaced the listener with `RawServer`, a ~150-line HTTP/1.1 server (virtual threads, keep-alive, Content-Length and chunked bodies)
that still passes `com.sun.net.httpserver.HttpExchange` subclasses to the unchanged handler. This is a deviation from "use the built-in HttpServer".

## Pitfall decisions (the ones the task flagged)
- Error order enforced by code order: auth, route 404, visibility 404, 403 (owner), 415, 413, 400, 422, 409, 428, 412.
- 404 bodies come from one code path (`problem(404)`), so they are byte-identical.
- If-Match: split on commas, trim, byte-compare each entry to `"<version>"`; any `*` entry gives 428; weak tags never match.
- Atomicity: one JVM-wide lock serializes SQLite access, and the update is `UPDATE ... WHERE id=? AND version=?`. 16-way case passed on 3 of 3 fresh runs.
- I-JSON: bytes decoded with a strict `CharsetDecoder` (REPORT) -> 400; after Jackson parsing, every string and key is scanned for unpaired surrogates -> 400.
- Lengths use `codePointCount`; trimming is a hand-written Unicode White_Space set (`String.strip()`/`Character.isWhitespace` would differ: it excludes NBSP, U+2007, U+202F and includes U+001C-001F).
- NUL characters round-trip through sqlite-jdbc.

## Spec ambiguities noticed
- ERR-3 says "non-empty body" gets 415 on every operation, including GET; implemented for all authenticated routed requests (after visibility 404/403).
- Member roster order is unspecified (owner first, then by id here).
- The suite cannot be re-run against a used database (`teams-carol-only-blue` sees teams created earlier), which should be documented in run.mjs or made robust.
- Duplicate JSON keys are unspecified; this build rejects them with 400.
- Percent-decoding of path ids is unspecified; ids are decoded, and malformed escapes give the generic 404.
