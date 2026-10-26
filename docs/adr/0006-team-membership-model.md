# ADR-0006: Team membership model (Tier 3)

- **Status:** Accepted (Patrick, 2026-10-26; cards proposed by Grok, refined by Claude)
- **Cards:** NOTES-FUNC-TEAM-2..5

> **Owner-managed membership with 403 for members:** In the context of small teams sharing notes, facing who may change membership and what non-owners see, we decided that only the owner adds or removes members, that a plain member gets 403 while a non-member gets the identical 404, and neglected using 404 for every disallowed action, to achieve honest errors for people who can already see the team without leaking a team's existence to outsiders, accepting a second "not allowed" status in the API.

> **Client-chosen slugs as team ids:** In the context of creating teams via curl and demos, facing readable ids versus collision-free UUIDs, we decided on client-chosen slugs (`^[a-z0-9-]{3,40}$`) with 409 on a taken slug, and neglected server-generated UUIDs, to achieve readable URLs consistent with the seeded `team-red`, accepting a conflict path clients must handle.

> **Unknown users are a validation error:** In the context of adding a member when there's no signup (users are seeded), facing 404 versus 422 for an unknown `userId`, we decided on 422 naming `userId`, and neglected 404, to achieve clear blame (the team path is valid, the input isn't), accepting a 422 on a body-less PUT.

> **Notes belong to the team:** In the context of removing a member, facing what happens to their notes, we decided that notes stay with the team and the removed author immediately gets 404, and neglected deleting or transferring the author's notes, to achieve no loss of shared work, accepting that former members can't retrieve their own writing.

> **The last owner can't leave (409):** In the context of owner-managed teams, facing orphaned teams nobody can administer, we decided that removing the last owner gets 409, and neglected ownership transfer for now, to achieve an always-administrable team, accepting that transfer is future work.

> **Where 403 and 409 go in the error order (added 16:05):** In the context of a fixed cross-language error order, facing 403 (a member who isn't the owner) and 409 (taken slug, last owner) with no defined place, we decided on 401 → 404 → **403** → 415 → 413 → 400 → 422 → **409** → 428 → 412, and neglected validate-then-authorize, to achieve that a caller who isn't allowed learns nothing about their payload and that forbidden bodies are never read, accepting that a non-owner gets no validation feedback (they couldn't act on it anyway). Node and Rust converged on this order independently, before it was pinned.
