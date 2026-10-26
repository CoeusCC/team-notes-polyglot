# ADR-0005: Cross-language pins from rebuild divergence

- **Status:** Accepted (Patrick, 2026-10-26)
- **Cards:** NOTES-FUNC-CONC-4/5, NOTES-FUNC-DEL-4/5, NOTES-TECH-ERR-3/4, NOTES-SEC-AUTHN-2, NOTES-SEC-AUTHZ-4, NOTES-FUNC-VALID-3, NOTES-TECH-FMT-2
- **Inputs:** `evidence/rebuilds.md` (divergence table), Grok PR #72 (adversarial cases), and Grok's interrogate review of e3083df/ae89b0d (blockers B1 and B2; S1–S10)

## Context
All 7 independent implementations passed the ratified suite, which shows the suite was *sufficient for what it pinned down*. Their build notes and Grok's adversarial cases showed where they **diverged**: If-Match lists and weak tags, invalid `?archived=`, empty bodies, unknown routes without a token, whether DELETE bumps the version, `errors[].field` for non-object bodies, and the whitespace set. Each divergence is a spot where a client would see different behavior depending on the backend.

## Decisions (Y-statements)
> **If-Match (CONC-4):** In the context of optimistic concurrency across languages that parse numbers differently, facing `"03"` matching version 3 in some runtimes, we decided on RFC 9110 strong comparison of the opaque ETag string (lists allowed, weak never matches, a list with `*` gets 428), and neglected numeric comparison, to achieve identical results everywhere, accepting stricter client requirements.

> **Uniform 415 (ERR-3), pushed back on by Patrick:** In the context of operations with and without request bodies, facing the agent's first recommendation to silently ignore stray bodies on restore, we decided that *any* non-empty non-JSON body gets 415 on *every* operation, and neglected per-operation exemptions, to achieve one rule that every language implements as a single middleware, an unconditional precedence order, and fail-fast feedback for confused clients, accepting about 2 extra lines in each backend.

> **Strict `archived` (DEL-4):** In the context of a parameter whose OpenAPI enum is `true|false`, facing all backends silently treating junk as `false` (so a trash request showed live notes), we decided on 422 naming `archived`, and neglected lenient coercion, to achieve agreement between spec and behavior, accepting a small change in all 5 backends.

> **Auth before routing (AUTHN-2):** In the context of route discovery, facing routers that 404 before auth runs, we decided that unauthenticated requests get 401 everywhere except `/health`, with a byte-identical 404 for unknown routes, trailing slashes and malformed escapes once authenticated, and neglected router-default behavior, to achieve no API-surface leak, accepting some router plumbing in each language.

> **DELETE semantics (DEL-5):** In the context of reversible soft delete, facing whether DELETE should bump the version or honor If-Match, we decided that DELETE changes neither and ignores If-Match, and neglected conditional delete, to achieve idempotent, retry-safe deletes (restore exists, so a stale delete can't lose data), accepting that a stale client can archive a note it hasn't seen.

> **Root error field and whitespace (VALID-3, FMT-2):** In the context of portable validation errors, facing `"$"` vs `"(body)"` and ASCII vs Unicode trimming, we decided on `"$"` (RFC 9535) and Unicode White_Space with code-point counting, and neglected each runtime's default `trim`, to achieve identical stored data and errors, accepting explicit trim implementations in PHP and Python.

> **Concurrency is falsified concurrently (CONC-5):** In the context of a lost-update guarantee checked by sequential cases, facing implementations that read and then write and could still pass, we decided to add a parallel case (16 simultaneous PATCHes, exactly one wins), and neglected trusting code review alone, to achieve evidence of atomicity, accepting a nondeterministic-looking (but deterministic in outcome) test.
