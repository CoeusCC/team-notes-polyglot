---
title: "Team Notes - acceptance criteria"
status: draft
ratified_by: ""
ratified_on: ""
format: "SpecDLC card (Claim / Binds / Interface / Forbids / Permits / Falsifier)"
---

# Team Notes: acceptance criteria

Status moves from `draft` to `ratified`, and only Patrick ratifies.

The key words MUST, MUST NOT and MAY follow RFC 2119. Aliases follow the pattern `NOTES-<KIND>-<CAT>-<N>`, where KIND is FUNC (behavior), SEC (security) or TECH (technical).

Each card's **Falsifier** is a concrete test that would refute the claim. Each falsifier maps to one or more cases in `conformance/cases.json` through `"falsifies": "<alias>"`.

Shared fixtures (seeded by `spec/schema.sql`):

| User | Token | Teams |
|---|---|---|
| alice | `tok_alice` | `team-red` (owner) |
| bob | `tok_bob` | `team-red` (member) |
| carol | `tok_carol` | `team-blue` (owner) |

---

## Tier 1: MVP, authenticated team notes

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
- **Claim.** `title` MUST be a string of 1–200 characters after trimming. `body` MUST be a string of at most 100,000 characters (it defaults to `""`). Unknown fields are rejected. Violations return `422` with a problem body whose `errors[]` names each failing field.
- **Forbids.** Persisting an invalid note, and a `500` for any malformed JSON (which gets `400`).
- **Falsifier.** An empty title, a 201-character title, a title given as a number, an unknown field `foo`, and a malformed JSON body. Each must get 422, or 400 for the bad JSON, and the list must stay unchanged.

#### NOTES-TECH-ERR-1: Errors are RFC 9457 problem details
- **Claim.** Every 4xx/5xx response has `Content-Type: application/problem+json` and a body containing `type`, `title` and `status`, where `status` equals the HTTP status.
- **Falsifier.** Every error case in the suite is checked against the `Problem` schema.

#### NOTES-TECH-CONTRACT-1: Responses match the OpenAPI contract
- **Claim.** Every response body validates against the schema declared in `spec/openapi.yaml` for that operation and status.
- **Falsifier.** The conformance runner validates every response with ajv. Any schema violation fails the run.

---

## Tier 2: concurrency and soft delete (outline, cards to be written)
- `NOTES-FUNC-CONC-1`: `GET` returns `ETag: "<version>"`.
- `NOTES-FUNC-CONC-2`: `PATCH` without `If-Match` gets `428`.
- `NOTES-FUNC-CONC-3`: `PATCH` with a stale `If-Match` gets `412` and leaves the note unchanged (the lost-update falsifier).
- `NOTES-FUNC-DEL-1`: `DELETE` is a soft delete and is idempotent (a second call also gets `204`).
- `NOTES-FUNC-DEL-2`: `POST /notes/{id}/restore` brings a note back.
- `NOTES-FUNC-DEL-3`: lists hide deleted notes unless `?archived=true` is passed.

## Tier 3: team management and search (outline)
- `NOTES-FUNC-TEAM-2..4`: create a team (the creator becomes its owner). Only the owner can add or remove members. A removed member immediately loses access.
- `NOTES-FUNC-TAG-1`, `NOTES-FUNC-SEARCH-1`: tags are lowercased and capped at 10. `?tag=` filters by tag. `?q=` does a case-insensitive substring search over title and body.
- `NOTES-FUNC-PAGE-1`: `limit` (1–100, default 20) plus an opaque `cursor`. Paging through all pages returns every note exactly once.
