# Build notes (Bun)

Started 16:17 CDT. First conformance run at 16:19:48 CDT: about 3 minutes wall-clock from first read of the spec to green. The whole task (docs and unit tests included) took about 6 minutes. A Docker image build takes seconds, and so does a conformance run.

- First run: 94/94 cases, 39/39 ACs (`FIRST_RUN.txt`).
- Iterations after the first run: 0. `FINAL_RUN.txt` is therefore identical to `FIRST_RUN.txt`; no fix was needed.
- Unit tests: 10 pass under `bun test` in Docker (U+0000 round-trip, I-JSON, error order, identical 404, 16-way race, teams, soft delete).

Design points:
- One handler: auth, then route match (any miss is the same constant 404), then visibility/permission (404, 403), then body checks in order 415, 413, 400, 422, then 409, 428, 412.
- The path is taken raw from `req.url` and split on `/`. Segments are decoded with try/catch, so `%E0`, `//` and trailing slashes yield the 404.
- Body: bytes, then strict UTF-8 (`fatal`, `ignoreBOM`), then `JSON.parse`, then a lone-surrogate tree walk (400).
- PATCH: If-Match is checked against the current version (428 / 412), then one conditional `UPDATE ... WHERE id=? AND version=? AND deleted_at IS NULL`. 0 changes means 412.
- bun:sqlite returned TEXT with embedded U+0000 intact (a unit test proves it).

Spec ambiguities / choices:
- PUT/DELETE member with a malformed JSON body: ignored (only 415/413 apply). The spec only says a JSON body is ignored on restore/DELETE.
- DELETE of a member id not in the team (or unknown): 204 (idempotent).
- PUT of the owner (already owner): 200 with role `owner`.
- `/health` with a non-GET method and no token: 401 (only GET /health is open).
- `?archived` given more than once: the last value wins if all values are valid.
