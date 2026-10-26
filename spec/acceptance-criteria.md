---
title: "Team Notes - acceptance criteria"
status: "tiers 1-2 ratified"
ratified_by: "Patrick"
ratified_on: "2026-10-26"
ratified_tiers: "1,2"
format: "SpecDLC card (Claim / Binds / Interface / Forbids / Permits / Falsifier)"
---

# Team Notes: acceptance criteria

Status moves from `draft` to `ratified`, and only Patrick ratifies.

The key words MUST, MUST NOT and MAY follow RFC 2119. Aliases follow the pattern `NOTES-<KIND>-<CAT>-<N>`, where KIND is FUNC (behavior), SEC (security) or TECH (technical).

Each card's **Falsifier** is a concrete test that would refute the claim. Each falsifier maps to one or more cases in `conformance/cases.json` through `"falsifies": "<alias>"`.

**Sets (ADR-0004).** Every card belongs to **Set: core** unless it says otherwise. Core cards are language-neutral behavior every implementation must have, and they are what the conformance suite checks. **Profile** cards (`Set: profile:<name>`) are smaller technical constraints for one environment, transport, language or SDK. They're listed at the end and are checked only where that profile applies.

Shared fixtures (seeded by `spec/schema.sql`):

| User | Token | Teams |
|---|---|---|
| alice | `tok_alice` | `team-red` (owner) |
| bob | `tok_bob` | `team-red` (member) |
| carol | `tok_carol` | `team-blue` (owner) |

---

## Tier 1: MVP, authenticated team notes (ratified by Patrick, 2026-10-26)

#### NOTES-SEC-AUTHN-1: Every endpoint except health requires a valid bearer token
- **Claim.** Requests without `Authorization: Bearer <token>`, or with an unknown token, get `401` and a `application/problem+json` body.
- **Binds.** All paths except `GET /health`.
- **Forbids.** Any 2xx response, or any note data, without a valid token.
- **Permits.** `GET /health` → `200` with no token.
- **Falsifier.** `GET /me`, `GET /teams` and `GET /teams/team-red/notes`, each with no token and with `Bearer nope`. Any status other than 401 refutes the claim.

#### NOTES-FUNC-ME-1: `/me` identifies the caller
- **Claim.** `GET /me` returns the caller's `id`, `name`, and the teams they belong to.
- **Falsifier.** As alice, `GET /me` returns `id=alice`, and her teams include `team-red` but not `team-blue`.

#### NOTES-FUNC-TEAM-1: `/teams` lists only the caller's teams
- **Claim.** `GET /teams` returns exactly the teams the caller is a member of.
- **Forbids.** Listing teams the caller does not belong to.
- **Falsifier.** As carol, the list is exactly `[team-blue]`.

#### NOTES-FUNC-NOTE-1: A team member can create a note
- **Claim.** `POST /teams/{teamId}/notes` with a valid `{title, body}` returns `201`, a `Location` header, and the note (`id`, `teamId`, `title`, `body`, `authorId`, `version=1`, `createdAt`, `updatedAt`).
- **Falsifier.** As alice, create in `team-red`. The response is 201, `authorId=alice`, `version=1`, and `GET Location` returns the same note.

#### NOTES-FUNC-NOTE-2: Teammates share notes
- **Claim.** Any member of a team can read and list the team's notes.
- **Falsifier.** Alice creates a note, and bob's `GET /notes/{id}` returns 200 with the same content. Bob's `GET /teams/team-red/notes` includes it.

#### NOTES-SEC-AUTHZ-1: Non-members cannot see that a note exists
- **Claim.** For a note in a team the caller is not a member of, read, update and delete return `404`, the same as for a note ID that does not exist.
- **Forbids.** `403`, and any body that differs between "exists but hidden" and "does not exist".
- **Interface.** Visibility is checked before the body is parsed or validated, so a non-member gets 404 even when the body is malformed or invalid.
- **Falsifier.** Carol sends GET, PATCH and DELETE to alice's team-red note and gets 404 each time. The problem `type`/`title` matches a request for a random UUID.

#### NOTES-SEC-AUTHZ-2: Non-members cannot list or create in a team
- **Claim.** `GET` and `POST /teams/{teamId}/notes` for a team the caller is not in, or one that does not exist, return `404`.
- **Falsifier.** Carol lists and creates in `team-red` and gets 404 both times. Afterwards, alice's list does not contain carol's attempted note.

#### NOTES-FUNC-NOTE-3: Members can update a note's title and body
- **Claim.** `PATCH /notes/{id}` with a partial `{title?, body?}` updates only those fields, increments `version`, and refreshes `updatedAt`.
- **Falsifier.** Bob patches the title of alice's note. Afterwards `version=2`, the title has changed, and the body is unchanged.

#### NOTES-FUNC-NOTE-4: Members can delete a note
- **Claim.** `DELETE /notes/{id}` returns `204`. After that, GET returns 404 and the note is no longer in the list.
- **Falsifier.** Delete, then GET → 404, then list → absent.
- *Tier 2 refines this into soft delete with restore (NOTES-FUNC-DEL-\*).*

#### NOTES-FUNC-VALID-1: Input is validated at the boundary
- **Claim.** `title` MUST be a string of 1–200 characters after trimming. `body` MUST be a string of at most 100,000 characters (it defaults to `""`). Unknown fields are rejected. A JSON body that is not an object, and a PATCH with no fields, are also rejected. Violations return `422` with a problem body whose `errors[]` names each failing field.
- **Forbids.** Persisting an invalid note, and a `500` for any malformed JSON (which gets `400`). A body over 2 MiB gets `413`.
- **Falsifier.** An empty title, a 201-character title, a title given as a number, an unknown field `foo`, and a malformed JSON body. Each must get 422, or 400 for the bad JSON, and the list must stay unchanged.

#### NOTES-TECH-ERR-1: Errors are RFC 9457 problem details
- **Claim.** Every 4xx/5xx response has `Content-Type: application/problem+json` and a body containing `type`, `title` and `status`, where `status` equals the HTTP status.
- **Falsifier.** Every error case in the suite is checked against the `Problem` schema.

#### NOTES-TECH-CONTRACT-1: Responses match the OpenAPI contract
- **Claim.** Every response body validates against the schema declared in `spec/openapi.yaml` for that operation and status.
- **Falsifier.** The conformance runner validates every response with ajv. Any schema violation fails the run.

#### NOTES-TECH-ERR-2: Error precedence is fixed (amendment, ratified 2026-10-26)
- **Claim.** When a request has several problems, the first applicable status wins, in this order: `401` (authentication) → `404` (not found or not visible) → `415` (a body is sent and `Content-Type` is not `application/json`) → `413` (body over 2 MiB) → `400` (malformed JSON) → `422` (validation) → `428` (missing or `*` `If-Match`) → `412` (stale `If-Match`).
- **Interface.** 413 comes before 400 because a server must stop reading an oversized body before it can know whether the body parses (ADR-0003).
- **Falsifier.** A non-member sending a `text/plain` malformed body gets 404. A member sending `text/plain` gets 415. A member sending an invalid body without `If-Match` gets 422.

#### NOTES-TECH-FMT-1: Wire formats are pinned (amendment, ratified 2026-10-26)
- **Claim.** Timestamps are RFC 3339 UTC with milliseconds and `Z` (`2026-10-26T20:20:43.252Z`). `Location` is a relative path (`/notes/{id}`). Lists are `{"items": [...]}` sorted newest first. Lengths are counted in Unicode code points. A title is stored trimmed.
- **Falsifier.** `createdAt` matches `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`. Two notes created in sequence list newest first. A 200-emoji title is accepted and a 201-emoji title is rejected. `"  hi  "` is stored as `"hi"`.

#### NOTES-SEC-AUTHZ-3: Hidden and malformed ids get the identical 404 (amendment, ratified 2026-10-26)
- **Claim.** The 404 body for a note in another team, for a random UUID, and for a malformed id (`/notes/not-a-uuid`) is byte-identical.
- **Falsifier.** Carol GETs alice's note, a random UUID and `not-a-uuid`. The three response bodies are byte-identical.

#### NOTES-FUNC-VALID-2: Read-only and null bodies are rejected (amendment, ratified 2026-10-26)
- **Claim.** Fields the server owns (`id`, `teamId`, `authorId`, `version`, `createdAt`, `updatedAt`, `deletedAt`) get 422 in POST and PATCH bodies. A body of `null`, `{}` (on PATCH) or a non-object gets 422. Every successful PATCH increments `version` by exactly 1, even if the values are unchanged.
- **Falsifier.** A PATCH with `{"authorId":"carol"}` → 422 with an `errors[]` entry for field `authorId`, and the note is unchanged. A PATCH with `null` → 422. A PATCH with the same title → 200 and version+1.

---

## Tier 2: concurrency and soft delete (ratified by Patrick, 2026-10-26; supersedes NOTE-3's unconditional PATCH and NOTE-4's delete wording)

#### NOTES-FUNC-CONC-1: Reads expose the version as a strong ETag
- **Claim.** `GET /notes/{id}`, `POST` (201), `PATCH` (200) and `POST …/restore` (200) return `ETag: "<version>"`, which always equals the body's `version`.
- **Falsifier.** Create a note: `ETag` is `"1"`. Patch it: `ETag` is `"2"`. GET then returns `ETag` `"2"`.

#### NOTES-FUNC-CONC-2: Updates require a precondition
- **Claim.** A `PATCH` without `If-Match`, or with `If-Match: *`, gets `428 Precondition Required` and changes nothing. A wildcard would skip lost-update protection (ADR-0002).
- **Forbids.** Unconditional updates, which would let lost updates through.
- **Falsifier.** PATCH with no `If-Match` → 428. PATCH with `If-Match: *` → 428. GET afterwards still shows `version=1` and the old title.
- *Supersedes Tier 1:* once ratified, the PATCH steps in the NOTES-FUNC-NOTE-3 and NOTES-SEC-AUTHZ-1 cases send `If-Match`.

#### NOTES-FUNC-CONC-3: A stale writer cannot overwrite a newer version (lost update)
- **Claim.** When `If-Match` doesn't equal the current ETag, `PATCH` gets `412 Precondition Failed`, the note is unchanged, and the response carries the current `ETag`.
- **Forbids.** Two writers holding the same ETag both succeeding.
- **Falsifier.** Alice and Bob both read v1. Alice PATCHes with `If-Match: "1"` → 200, v2. Bob PATCHes with `If-Match: "1"` → 412. GET shows Alice's title at v2.

#### NOTES-FUNC-DEL-1: Delete is soft and idempotent
- **Claim.** `DELETE /notes/{id}` on a live or already-deleted note in the caller's team returns `204`. Afterwards the note is hidden from GET and PATCH (404), but its data is kept.
- **Falsifier.** DELETE → 204, DELETE again → 204, then GET → 404.

#### NOTES-FUNC-DEL-2: Deleted notes can be restored
- **Claim.** `POST /notes/{id}/restore` by a team member returns 200 with the note and increments `version`, so a writer still holding a pre-delete ETag gets 412 (ADR-0002). GET works again afterwards. Restoring a live note is a no-op 200 that leaves the version unchanged.
- **Forbids.** Non-members restoring (404). Losing content through delete followed by restore.
- **Falsifier.** Create, DELETE, restore → 200 with the same title and body and `version=2`. Carol restoring → 404.

#### NOTES-FUNC-DEL-3: Lists hide deleted notes unless asked
- **Claim.** `GET /teams/{teamId}/notes` excludes deleted notes. With `?archived=true` it lists **only** deleted notes, as a trash view, each with a `deletedAt` value. `deletedAt` is an optional field on `Note`, present only on deleted notes (ADR-0002).
- **Falsifier.** A deleted note is absent from the default list and present in `?archived=true`. A live note is the reverse.

## Tier 2.1: cross-language pins (Set: core; ratified by Patrick, 2026-10-26)
*Origin: four independent rebuilds plus Grok's replications passed 45/45 but **diverged** on behavior the suite didn't pin down. Grok drafted adversarial cases (PR #72) and an interrogate review, and Patrick decided each point. Rationale: ADR-0005.*

#### NOTES-FUNC-CONC-4: If-Match uses RFC 9110 strong comparison on the opaque ETag string
- **Claim.** `If-Match` is a comma-separated list of entity tags. It matches only if some entry is a strong tag **byte-equal** to the current `ETag` (`"3"`; not `"03"`, not unquoted `3`). A weak tag (`W/"3"`) never matches. A list containing `*` gets 428 (CONC-2).
- **Falsifier.** On v1: `W/"1"` → 412; `"9", "1"` → 200; `"8", "9"` → 412; `"1", *` → 428; `"01"` → 412; `1` → 412.

#### NOTES-FUNC-CONC-5: Under concurrency exactly one writer wins
- **Claim.** N simultaneous PATCHes that carry the same current `If-Match` produce exactly one 200 and N−1 412s, and the version increases by exactly 1.
- **Interface.** The check and the increment are one atomic conditional update (`UPDATE … WHERE version = ?`), never a read followed by a write.
- **Falsifier.** 16 parallel PATCHes with `If-Match: "1"` → status counts `{200: 1, 412: 15}`, and GET then shows `version=2`.

#### NOTES-FUNC-DEL-4: `archived` accepts only `true` or `false`
- **Claim.** Any other value of `?archived=` (`yes`, `1`, `TRUE`, empty) gets 422 with `errors[].field = "archived"`.
- **Falsifier.** `?archived=yes`, `=1`, `=TRUE`, `=` → 422 naming `archived`.

#### NOTES-FUNC-DEL-5: DELETE changes no version and ignores If-Match
- **Claim.** DELETE (first or repeated) leaves `version` and `updatedAt` unchanged and sets only `deletedAt`. It ignores `If-Match`, because delete is reversible (restore) and so can't lose data.
- **Falsifier.** v1 → DELETE → DELETE → restore gives `version=2`. A DELETE carrying a stale `If-Match` → 204.

#### NOTES-TECH-ERR-3: Body media rules are uniform across operations
- **Claim.** Any request with a **non-empty** body whose media type is not `application/json` gets 415, on every operation, including restore and DELETE (after the visibility 404). An **empty** body on an operation that requires one (create, PATCH) gets 400, whatever its `Content-Type`. A JSON body on restore or DELETE is ignored.
- **Falsifier.** A non-member restoring with a `text/plain` body → 404. A member doing the same → 415. A member restoring with no body → 200. An empty POST body with JSON, text/plain or no Content-Type → 400.

#### NOTES-TECH-ERR-4: Each adjacent precedence pair is falsified
- **Claim.** ERR-2's order holds for each adjacent pair: 401>404, 404>413, 413>400, 400>422, and 428 on stale data with no `If-Match`.
- **Falsifier.** A bad token on another team's note → 401. A non-member sending an oversized body → 404. An oversized malformed body → 413. A malformed body with a valid `If-Match` → 400. No `If-Match` after the note has moved on → 428.

#### NOTES-SEC-AUTHN-2: Unknown routes don't reveal the API surface
- **Claim.** Without a valid token, any path except `/health` gets 401, including unknown routes and verbs. With a token, unknown routes and verbs, a trailing slash (`/notes/{id}/`) and malformed percent-escapes (`/notes/%E0`) all get the byte-identical 404.
- **Falsifier.** `GET /nope` with no token → 401. `GET /notes/%E0` as carol → the same bytes as a random UUID. `GET /notes/{id}/` → the same 404.

#### NOTES-SEC-AUTHZ-4: The 404 body is identical for every verb and for deleted notes
- **Claim.** A non-member's PATCH, DELETE and restore, and a member's GET or PATCH of a deleted note, all return the same 404 bytes as a random id.
- **Falsifier.** Compare each body with `bodyEquals` against the random-UUID 404.

#### NOTES-FUNC-VALID-3: Errors for non-object bodies name the JSON root
- **Claim.** A body that is valid JSON but not an object (array, string, number, null) gets 422 with `errors[].field = "$"` (RFC 9535 root). `__proto__` is an unknown field and gets 422.
- **Falsifier.** `[]`, `"x"`, `1` and `null` each get 422 with field `$`. `{"title":"t","__proto__":{}}` gets 422 naming `__proto__`.

#### NOTES-TECH-FMT-2: Trimming uses Unicode White_Space, and lengths count code points
- **Claim.** Titles are trimmed of Unicode `White_Space` characters (including NBSP, U+2003 and U+3000; not U+200B or U+FEFF). Lengths count code points: `e`+U+0301 counts 2, and a ZWJ family emoji counts 5.
- **Falsifier.** `"\u00a0hi\u3000"` is stored as `"hi"`. A title made only of NBSP → 422. A lone ZWSP title is valid. 200 code points with combiners → 201; 202 → 422.

---

## Profiles (Set: profile:<name>; ADR-0004)
Smaller technical constraints that apply only to some environments. They're not part of the core suite.

#### PROFILE-TRANSPORT-1: A 413 closes the connection (Set: profile:http1-keepalive)
- **Claim.** When a server refuses to read an oversized body on a keep-alive HTTP/1.1 connection, it sends `Connection: close` so the socket isn't reused with unread bytes.
- **Falsifier.** After a 413, the next request on the same client succeeds (no `fetch failed`).

#### PROFILE-PHP-1: The PHP built-in server runs workers (Set: profile:php-cli-server)
- **Claim.** `PHP_CLI_SERVER_WORKERS ≥ 2`, so one slow request doesn't block the others. SQLite file-locking keeps the writes safe.
- **Falsifier.** The bench `contention` scenario on the PHP container shows 0 lost updates.

#### PROFILE-SQLITE-1: Storage is single-writer SQLite (Set: profile:sqlite)
- **Claim.** All writes go through SQLite, which serializes them. Atomicity (CONC-5) comes from conditional UPDATE statements, not from application locks.
- **Falsifier.** The bench `contention` scenario shows 0 lost updates on every backend.


## Tier 3: team management and search (outline)
- `NOTES-FUNC-TEAM-2..4`: create a team (the creator becomes its owner). Only the owner can add or remove members. A removed member immediately loses access.
- `NOTES-FUNC-TAG-1`, `NOTES-FUNC-SEARCH-1`: tags are lowercased and capped at 10. `?tag=` filters by tag. `?q=` does a case-insensitive substring search over title and body.
- `NOTES-FUNC-PAGE-1`: `limit` (1–100, default 20) plus an opaque `cursor`. Paging through all pages returns every note exactly once.
