# Acceptance criteria index

A card in `spec/acceptance-criteria.md` has a Claim, a Forbids list and a Falsifier. The Falsifier is a concrete test that would refute the Claim. A case in `conformance/cases.json` points at a card with `"falsifies": "<alias>"`, so a failing case means the card does not hold for that backend. Patrick ratifies the cards, and no card changes status without him. To run every case against a backend, run `node conformance/run.mjs --strict`.

This page lists the 40 core cards by tier. The 3 profile cards are at the end. Case counts come from `cases.json`. Origin is inferred from the card text and the ADRs in `docs/adr/`.

## Tier 1: MVP, authenticated team notes

| Alias | Claim | Cases | Origin |
|---|---|---|---|
| [NOTES-SEC-AUTHN-1](../spec/acceptance-criteria.md#notes-sec-authn-1-every-endpoint-except-health-requires-a-valid-bearer-token) | Every endpoint except health needs a valid bearer token, else 401. | 4 | initial |
| [NOTES-FUNC-ME-1](../spec/acceptance-criteria.md#notes-func-me-1-me-identifies-the-caller) | GET /me returns the caller id, name and teams. | 1 | initial |
| [NOTES-FUNC-TEAM-1](../spec/acceptance-criteria.md#notes-func-team-1-teams-lists-only-the-callers-teams) | GET /teams lists only teams the caller belongs to. | 2 | initial |
| [NOTES-FUNC-NOTE-1](../spec/acceptance-criteria.md#notes-func-note-1-a-team-member-can-create-a-note) | A team member can create a note and gets 201 with Location. | 3 | initial |
| [NOTES-FUNC-NOTE-2](../spec/acceptance-criteria.md#notes-func-note-2-teammates-share-notes) | Any member of a team can read and list its notes. | 1 | initial |
| [NOTES-SEC-AUTHZ-1](../spec/acceptance-criteria.md#notes-sec-authz-1-non-members-cannot-see-that-a-note-exists) | Non-members get 404 on read, update and delete of a note. | 2 | initial |
| [NOTES-SEC-AUTHZ-2](../spec/acceptance-criteria.md#notes-sec-authz-2-non-members-cannot-list-or-create-in-a-team) | Non-members get 404 when listing or creating in a team. | 2 | initial |
| [NOTES-FUNC-NOTE-3](../spec/acceptance-criteria.md#notes-func-note-3-members-can-update-a-notes-title-and-body) | PATCH updates only the given fields and increments version. | 1 | initial |
| [NOTES-FUNC-NOTE-4](../spec/acceptance-criteria.md#notes-func-note-4-members-can-delete-a-note) | DELETE returns 204 and the note disappears from GET and lists. | 1 | initial |
| [NOTES-FUNC-VALID-1](../spec/acceptance-criteria.md#notes-func-valid-1-input-is-validated-at-the-boundary) | Title, body and unknown fields are validated at the boundary with 422 or 400. | 11 | initial |
| [NOTES-TECH-ERR-1](../spec/acceptance-criteria.md#notes-tech-err-1-errors-are-rfc-9457-problem-details) | Every 4xx/5xx is RFC 9457 problem+json with matching status. | 2 | initial |
| [NOTES-TECH-CONTRACT-1](../spec/acceptance-criteria.md#notes-tech-contract-1-responses-match-the-openapi-contract) | Every response body validates against spec/openapi.yaml. | 1 | initial |
| [NOTES-TECH-ERR-2](../spec/acceptance-criteria.md#notes-tech-err-2-error-precedence-is-fixed-amendment-ratified-2026-10-26) | Fixed precedence when a request has several problems. | 3 | amendment (Grok review) |
| [NOTES-TECH-FMT-1](../spec/acceptance-criteria.md#notes-tech-fmt-1-wire-formats-are-pinned-amendment-ratified-2026-10-26) | Timestamps, Location, list shape, code-point lengths and trimmed titles are pinned. | 3 | amendment (Grok review) |
| [NOTES-SEC-AUTHZ-3](../spec/acceptance-criteria.md#notes-sec-authz-3-hidden-and-malformed-ids-get-the-identical-404-amendment-ratified-2026-10-26) | Hidden, random and malformed note ids get a byte-identical 404. | 1 | amendment (Grok review) |
| [NOTES-FUNC-VALID-2](../spec/acceptance-criteria.md#notes-func-valid-2-read-only-and-null-bodies-are-rejected-amendment-ratified-2026-10-26) | Server-owned fields and null bodies get 422; each PATCH adds exactly 1 to version. | 1 | amendment (Grok review) |

## Tier 2: concurrency and soft delete

| Alias | Claim | Cases | Origin |
|---|---|---|---|
| [NOTES-FUNC-CONC-1](../spec/acceptance-criteria.md#notes-func-conc-1-reads-expose-the-version-as-a-strong-etag) | Reads and writes expose the version as a strong ETag. | 1 | initial |
| [NOTES-FUNC-CONC-2](../spec/acceptance-criteria.md#notes-func-conc-2-updates-require-a-precondition) | PATCH without If-Match, or with *, gets 428 and changes nothing. | 1 | initial |
| [NOTES-FUNC-CONC-3](../spec/acceptance-criteria.md#notes-func-conc-3-a-stale-writer-cannot-overwrite-a-newer-version-lost-update) | A stale If-Match gets 412 and the note is unchanged. | 1 | initial |
| [NOTES-FUNC-DEL-1](../spec/acceptance-criteria.md#notes-func-del-1-delete-is-soft-and-idempotent) | DELETE is soft and idempotent; the note then returns 404. | 1 | initial |
| [NOTES-FUNC-DEL-2](../spec/acceptance-criteria.md#notes-func-del-2-deleted-notes-can-be-restored) | Restore returns the note with version+1; a live note is a no-op. | 1 | initial |
| [NOTES-FUNC-DEL-3](../spec/acceptance-criteria.md#notes-func-del-3-lists-hide-deleted-notes-unless-asked) | Lists hide deleted notes; ?archived=true lists only deleted ones. | 1 | initial |

## Tier 2.1: cross-language pins

| Alias | Claim | Cases | Origin |
|---|---|---|---|
| [NOTES-FUNC-CONC-4](../spec/acceptance-criteria.md#notes-func-conc-4-if-match-uses-rfc-9110-strong-comparison-on-the-opaque-etag-string) | If-Match uses RFC 9110 strong comparison on the opaque ETag string. | 5 | cross-language divergence |
| [NOTES-FUNC-CONC-5](../spec/acceptance-criteria.md#notes-func-conc-5-under-concurrency-exactly-one-writer-wins) | N parallel PATCHes with one If-Match give one 200 and N-1 412s. | 1 | cross-language divergence |
| [NOTES-FUNC-DEL-4](../spec/acceptance-criteria.md#notes-func-del-4-archived-accepts-only-true-or-false) | ?archived accepts only true or false; anything else gets 422. | 4 | cross-language divergence |
| [NOTES-FUNC-DEL-5](../spec/acceptance-criteria.md#notes-func-del-5-delete-changes-no-version-and-ignores-if-match) | DELETE changes no version and ignores If-Match. | 2 | cross-language divergence |
| [NOTES-TECH-ERR-3](../spec/acceptance-criteria.md#notes-tech-err-3-body-media-rules-are-uniform-across-operations) | Non-empty non-JSON bodies get 415 on every operation; empty required bodies get 400. | 5 | cross-language divergence |
| [NOTES-TECH-ERR-4](../spec/acceptance-criteria.md#notes-tech-err-4-each-adjacent-precedence-pair-is-falsified) | Each adjacent pair in the error precedence order is falsified. | 1 | cross-language divergence |
| [NOTES-SEC-AUTHN-2](../spec/acceptance-criteria.md#notes-sec-authn-2-unknown-routes-dont-reveal-the-api-surface) | Unknown routes give 401 without a token and an identical 404 with one. | 5 | cross-language divergence |
| [NOTES-SEC-AUTHZ-4](../spec/acceptance-criteria.md#notes-sec-authz-4-the-404-body-is-identical-for-every-verb-and-for-deleted-notes) | The 404 body is identical for every verb and for deleted notes. | 1 | cross-language divergence |
| [NOTES-FUNC-VALID-3](../spec/acceptance-criteria.md#notes-func-valid-3-errors-for-non-object-bodies-name-the-json-root) | Non-object JSON bodies get 422 with field "$". | 5 | cross-language divergence |
| [NOTES-TECH-FMT-2](../spec/acceptance-criteria.md#notes-tech-fmt-2-trimming-uses-unicode-white_space-and-lengths-count-code-points) | Titles trim Unicode White_Space; lengths count code points. | 9 | cross-language divergence |

## Tier 3: team management

| Alias | Claim | Cases | Origin |
|---|---|---|---|
| [NOTES-FUNC-TEAM-2](../spec/acceptance-criteria.md#notes-func-team-2-anyone-can-create-a-team-and-becomes-its-owner) | Anyone can create a team and becomes its owner; taken id gets 409. | 2 | initial |
| [NOTES-FUNC-TEAM-3](../spec/acceptance-criteria.md#notes-func-team-3-only-the-owner-manages-membership) | Only the owner adds or removes members; others get 403 or 404. | 1 | initial |
| [NOTES-FUNC-TEAM-4](../spec/acceptance-criteria.md#notes-func-team-4-access-follows-membership-immediately-notes-stay-with-the-team) | Access follows membership immediately; notes stay with the team. | 1 | initial |
| [NOTES-FUNC-TEAM-5](../spec/acceptance-criteria.md#notes-func-team-5-members-can-see-the-team-and-its-roster) | Members can read the team and its roster; non-members get 404. | 1 | initial |
| [NOTES-TECH-ERR-5](../spec/acceptance-criteria.md#notes-tech-err-5-403-and-409-have-fixed-places-in-the-error-order-ratified-by-patrick-2026-10-26-adr-0006) | 403 and 409 have fixed places in the error order. | 1 | Patrick decision |
| [NOTES-TECH-FMT-3](../spec/acceptance-criteria.md#notes-tech-fmt-3-strings-must-be-valid-unicode-and-limits-are-exact-from-red-team--mutation-testing-2026-10-26) | Bodies must be I-JSON; lone surrogates get 400; limits are inclusive. | 4 | red team |
| [NOTES-SEC-AUTHN-3](../spec/acceptance-criteria.md#notes-sec-authn-3-malformed-paths-never-produce-5xx-from-red-team-2026-10-26) | Malformed paths such as // never produce a 5xx. | 1 | red team |
| [NOTES-SEC-AUTHN-4](../spec/acceptance-criteria.md#notes-sec-authn-4-ambiguous-credentials-and-path-tricks-are-rejected-consistently-ratified-by-patrick-2026-10-26) | Duplicate Authorization gives 401; unreserved escapes decode; dot segments 404. | 3 | cross-language divergence |

## Profile cards

Profile cards apply only to one environment (ADR-0004). The core suite has no cases for them.  Their falsifiers are a post-413 request on the same client and the bench `contention` scenario.

| Alias | Claim | Set |
|---|---|---|
| [PROFILE-TRANSPORT-1](../spec/acceptance-criteria.md#profile-transport-1-a-413-closes-the-connection-set-profilehttp1-keepalive) | A 413 on a keep-alive HTTP/1.1 connection sends Connection: close. | profile:http1-keepalive |
| [PROFILE-PHP-1](../spec/acceptance-criteria.md#profile-php-1-the-php-built-in-server-runs-workers-set-profilephp-cli-server) | The PHP built-in server runs at least 2 workers. | profile:php-cli-server |
| [PROFILE-SQLITE-1](../spec/acceptance-criteria.md#profile-sqlite-1-storage-is-single-writer-sqlite-set-profilesqlite) | All writes go through single-writer SQLite; atomicity uses conditional UPDATE. | profile:sqlite |

## How cards got sharper

Each example shows the card wording at each step, what exposed the gap, and the case that now pins it. Times are the commit times from `git log` on 2026-10-26.

### 1. Concurrency

| Step | Card | Wording | Commit |
|---|---|---|---|
| 1 | NOTES-FUNC-NOTE-3 | PATCH updates the given fields and increments `version`. It carries no precondition, so two writers can overwrite each other. | db216cf (15:12) |
| 2 | NOTES-FUNC-CONC-1, -2, -3 | The version becomes a strong ETag. PATCH needs `If-Match`: missing or `*` gets 428, a stale value gets 412. | 29c9477 (15:22), ratified 42eea30 (15:28), cases in ae89b0d (15:33) |
| 3 | NOTES-FUNC-CONC-4 | `If-Match` is a list of strong tags compared byte for byte with the ETag. `"03"` must not match version 3. | da2f444 (15:54) |
| 4 | NOTES-FUNC-CONC-5 | 16 parallel PATCHes with the same `If-Match` give exactly one 200 and fifteen 412s. | da2f444 (15:54) |

What exposed the gaps: the first rebuilds passed CONC-1 to CONC-3 and still diverged. Some runtimes compared `If-Match` as a number, so `"03"` matched v3 in some languages and not in others (ADR-0005). The sequential cases also could not tell an atomic conditional update from a read followed by a write, because nothing ran two requests at once.

Cases that pin it: `patch-requires-if-match` and `lost-update-prevented` for step 2. The CONC-4 cases are `pin-ifmatch-weak`, `pin-ifmatch-list-contains-current`, `pin-ifmatch-list-all-stale`, `pin-ifmatch-list-with-star` and `pin-ifmatch-opaque-string`. The CONC-5 case is `pin-concurrent-patches-one-wins`.

### 2. Text input

| Step | Card | Wording | Commit |
|---|---|---|---|
| 1 | NOTES-FUNC-VALID-1 | A title is 1 to 200 characters after trimming. | db216cf (15:12) |
| 2 | NOTES-TECH-FMT-1 | Length counts Unicode code points, and the title is stored trimmed. | ae89b0d (15:33) |
| 3 | NOTES-TECH-FMT-2 | Trim removes Unicode `White_Space` (NBSP, U+2003, U+3000) and not U+200B or U+FEFF. | da2f444 (15:54) |
| 4 | NOTES-TECH-FMT-3 | Bodies must be I-JSON. A lone surrogate escape gets 400. Limits are inclusive. | 1ddd73c (16:09) |

What exposed the gaps: "characters" meant different things in different languages, so FMT-1 chose code points (ADR-0003). After the rebuilds, Python's `strip()` was found trimming U+001C to U+001F, which are not Unicode White_Space, and other runtimes trimmed only ASCII. That led to FMT-2 and the explicit trim in the Python backend (22aae10). The red-team fuzzer then found that a lone surrogate had 4 different behaviors across 5 languages, and Patrick chose 400 over 422. Mutation testing found that no case covered the exact 100,000 code-point limit.

Cases that pin it: the nine `pin-trim-*`, `pin-zwsp-not-whitespace`, `pin-combining-*` and `pin-zwj-family-counts-cp` cases for FMT-2. For FMT-3: `redteam-lone-surrogate-rejected`, `redteam-invalid-utf8-400`, `redteam-nul-roundtrip` and `mutation-body-limit-inclusive`.

### 3. Visibility

| Step | Card | Wording | Commit |
|---|---|---|---|
| 1 | NOTES-SEC-AUTHZ-1 | A non-member gets 404 for a note in another team, the same as for an unknown id. | db216cf (15:12) |
| 2 | NOTES-SEC-AUTHZ-3 | The 404 bodies for hidden, random and malformed ids are byte-identical. | ae89b0d (15:33) |
| 3 | NOTES-SEC-AUTHN-2, NOTES-SEC-AUTHZ-4 | Malformed escapes, a trailing slash and every verb give the same 404. Unknown routes give 401 without a token. | da2f444 (15:54) |
| 4 | NOTES-SEC-AUTHN-3 | No path, including `//`, produces a 5xx. | 1ddd73c (16:09) |
| 5 | NOTES-SEC-AUTHN-4 | Duplicate `Authorization` gives 401. Unreserved escapes decode. Dot segments give 404. | a52f69e (16:19) |

What exposed the gaps: AUTHZ-1 compared a hidden note with a random UUID, and Grok's adversarial review (ADR-0003) added malformed ids to the comparison. The rebuilds diverged on unknown routes, verbs and escapes (ADR-0005). The red-team fuzzer (invariant I1) found `GET //` and `POST //` returning 500 on node-ts. A probe across 5 backends then found split behavior on duplicate `Authorization` headers and dot segments (3/2 and 4/1 splits), which became AUTHN-4.

Cases that pin it: `identical-404-bodies`, then `pin-unknown-route-no-token`, `pin-unknown-verb-no-token`, `pin-unknown-route-with-token`, `pin-malformed-escape-404`, `pin-trailing-slash-404` and `pin-identical-404-all-verbs`, then `redteam-double-slash-no-5xx`, then `authn4-duplicate-authorization-401`, `authn4-unreserved-decoded` and `authn4-dot-segments-404`.

## Origin counts

| Origin | Core cards |
|---|---|
| initial | 22 |
| amendment (Grok review) | 4 |
| cross-language divergence | 11 |
| red team | 2 |
| mutation testing | 0 |
| Patrick decision | 1 |

Two choices are judgment calls. NOTES-TECH-FMT-3 came from both the red team and mutation testing, and is counted under red team. The Tier 2 and Tier 3 cards are counted as initial because they were drafted as planned tiers, even though Patrick decided their open questions (ADR-0002, ADR-0006).

## Coverage

40 core cards, 97 cases (every case falsifies exactly one core card). Cases per card: min 1, median 1, max 11.
