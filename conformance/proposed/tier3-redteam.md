# Proposed: Tier 3 red-team cases (re-add, remove vs. write)

**Status: PROPOSED, NOT RATIFIED.** Drafted by Grok at Claude's request. Nothing here changes `cases.json`, and it stays unmerged until Patrick decides. The cases reuse the ratified aliases NOTES-FUNC-TEAM-3 and TEAM-4 and encode only behavior the spec and ADR-0006 already determine.

## What the sources say
- `spec/openapi.yaml`: `PUT /teams/{teamId}/members/{userId}` is "Owner only. Idempotent." and returns 200 with a Member. `DELETE` is "Owner only. Idempotent. Removing the last owner gets 409." and returns 204.
- TEAM-3: add gives 200 `{id, name, role: "member"}` and is idempotent. Remove gives 204 and is idempotent.
- TEAM-4: "A newly added member can read notes created before they joined. A removed member gets the identical 404 ... on their very next request, including notes they wrote. Their notes remain visible to the remaining members."
- ADR-0006: notes belong to the team, and the last owner can't leave (409). There's one owner and no transfer, so **owner self-removal is already pinned** by TEAM-3's falsifier (owner removing herself gives 409), and no new case is added.

## Proposed cards (refinements of TEAM-3 and TEAM-4)

### TEAM-REDTEAM-A: Re-adding a removed member restores access (refines TEAM-4)
- **Claim.** After remove and then re-add, the user is a plain member again. They can read their own earlier notes and notes written while they were away. The roster lists them once.
- **Binds.** PUT and DELETE members, GET notes, GET team, and GET roster.
- **Forbids.** A stale "removed" state surviving the re-add, duplicate roster rows, or a role other than `member`.
- **Permits.** Any internal representation, such as hard-deleting or flagging the membership row.
- **Falsifier.** `proposed-team-readd-restores-access` and `proposed-team-remove-and-readd-idempotent` (the second also covers double DELETE giving 204 twice and double PUT giving 200 twice).

### TEAM-REDTEAM-B: Removal takes effect before any later write (refines TEAM-4)
- **Claim.** Once DELETE returns 204, every later request by the removed member gets 404, including PATCH and DELETE on their own note and POST to the team. The note is unchanged at version 1.
- **Binds.** PATCH and DELETE `/notes/{id}`, and POST `/teams/{id}/notes`.
- **Forbids.** A write accepted after the removal is acknowledged, for example from a cached membership.
- **Permits.** A write that is *concurrent* with the DELETE can linearize either before it (200) or after it (404).
- **Falsifier.** `proposed-team-removed-member-cannot-write`, plus `proposed-team-remove-races-writes` (4 parallel DELETEs give 204 x4, then 8 parallel PATCHes give 404 x8, and the version stays 1).

## Limits and open questions for Patrick
1. **True interleaving isn't expressible.** The runner's `parallel` repeats one step, so it can't overlap a DELETE with a PATCH. The "race" case runs parallel phases one after another. The spec doesn't say what a truly concurrent write may return (200 before or 404 after). Should we pin "either, but never a 500 and never a write after the 204" with a new runner primitive, or leave it?
2. Should these become new aliases (TEAM-6/TEAM-7) or stay as extra cases under TEAM-3 and TEAM-4? That needs an AC change and ratification.
3. The 404 for a removed member writing with a *stale* If-Match is assumed to win over 412, following the error order (404 before 412). That's consistent with ERR-5, so please confirm.

## Raw run (node-ts, port 3101, server already running locally, origin/main a52f69e)
```
ok   proposed-team-readd-restores-access [NOTES-FUNC-TEAM-4]
ok   proposed-team-remove-and-readd-idempotent [NOTES-FUNC-TEAM-3]
ok   proposed-team-removed-member-cannot-write [NOTES-FUNC-TEAM-4]
ok   proposed-team-remove-races-writes [NOTES-FUNC-TEAM-4]

4/4 cases passed · ACs: 2 passed, 0 refuted, 38 unverified (ratified, no case) · BASE_URL=http://localhost:3101
```
