# ADR-0003: Error precedence, strict media type, and code-point lengths

- **Status:** Accepted (decided by Patrick on 2026-10-26, from Grok's adversarial AC review)
- **Cards:** NOTES-TECH-ERR-2, NOTES-TECH-FMT-1, NOTES-SEC-AUTHZ-3, NOTES-FUNC-VALID-2

## Decision 1: one fixed error precedence, with 415 for non-JSON bodies
> In the context of a contract implemented independently in several languages, facing requests that break several rules at once (for example a non-member sending malformed text/plain), we decided on the fixed order 401 → 404 → 415 → 413 → 400 → 422 → 428 → 412 and to reject non-`application/json` bodies with 415, and neglected letting each implementation pick an order or accepting any media type, to achieve byte-for-byte comparable behavior across backends and no information leaks (visibility is decided before anything about the body is revealed), accepting that clients must send the correct `Content-Type`.

*Deviation from the proposed order:* 413 comes before 400, because a server must stop reading an oversized body before it can know whether that body is valid JSON.

## Decision 2: lengths are counted in Unicode code points, and titles are stored trimmed
> In the context of title and body limits enforced by backends in JS, Python, PHP, Rust and others, facing languages that count string length differently (UTF-16 units, bytes, code points), we decided to count Unicode code points and to store the trimmed title, and neglected UTF-16 units and UTF-8 bytes, to achieve one definition every language can implement natively and that matches what users perceive for most text, accepting that grapheme clusters (e.g. family emoji) count as several characters.

## Decision 3: the wire formats are pinned
> In the context of a black-box conformance suite, facing ambiguity in timestamps, Location and list shape, we decided on RFC 3339 UTC with milliseconds and `Z`, a relative `Location`, `{items: [...]}` sorted newest first, and byte-identical 404 bodies for hidden, missing and malformed ids, and neglected leaving them to each implementation, to achieve deterministic cross-backend comparison and no existence leaks, accepting a little less freedom in each backend.

## Not adopted
- **405 for unknown verbs:** an unknown method on a known path gets the same 404 as an unknown route, so the API doesn't reveal its route surface. A future card can revisit this.
