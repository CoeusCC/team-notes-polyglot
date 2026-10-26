# Proposed card text (draft, for Patrick to ratify; not applied to spec/acceptance-criteria.md)

#### NOTES-FUNC-CONC-4: If-Match uses strong comparison over a list (proposed)
- **Claim.** `If-Match` is a comma-separated list of entity tags compared strongly (RFC 9110 §13.1.1). A PATCH succeeds if any listed strong tag equals the current ETag. Weak tags (`W/"n"`) never match. A list containing `*` is treated like `*` → 428.
- **Falsifier.** On v1: `W/"1"` → 412; `"9", "1"` → 200; `"8", "9"` → 412; `"1", *` → 428.

#### NOTES-FUNC-DEL-4: The archived flag is strict (proposed)
- **Claim.** `archived` accepts only `true` or `false`, case-sensitive. Any other value, including empty, gets 422 with `errors[].field = "archived"`. *Spec change:* add a `422` response to `listNotes`.
- **Falsifier.** `?archived=yes|1|TRUE|` → 422 each.

#### NOTES-TECH-ERR-3: A zero-length body is malformed JSON (proposed)
- **Claim.** A POST or PATCH with `Content-Length: 0` counts as "no body sent", so 415 doesn't apply. It gets 400, whatever the Content-Type.
- **Falsifier.** An empty POST with `application/json`, with no Content-Type, or with `text/plain` → 400. An empty PATCH with a valid If-Match → 400.

#### NOTES-SEC-AUTHN-2: Authentication precedes routing (proposed)
- **Claim.** Every path except `GET /health`, including unknown paths and verbs, returns 401 without a valid token. With a valid token, an unknown path or verb returns the standard 404.
- **Falsifier.** `GET /nope` and `PUT /me` with no token → 401. `GET /nope` as alice → 404.

#### NOTES-FUNC-DEL-2 amendment: Delete doesn't touch the version (proposed)
- **Claim (added).** DELETE, including a repeated DELETE, leaves `version` and `updatedAt` unchanged and sets `deletedAt`. Only restoring a deleted note increments `version`.
- **Falsifier.** Create, DELETE, DELETE: the trash lists it at `version=1`. Restore → `ETag "2"`. Restore again → still `"2"`.

#### NOTES-FUNC-VALID-1 amendment: The root field name is "$" (proposed)
- **Claim (added).** When the body isn't a JSON object (array, string, number, null), `errors[]` has exactly one entry with `field = "$"`.
- **Falsifier.** POST `[1]`, `"x"`, `42` and `null` → 422 with `errors[].field = "$"`.

#### NOTES-TECH-FMT-1 amendment: Trimming means Unicode White_Space (proposed)
- **Claim (added).** Trimming removes leading and trailing characters with the Unicode `White_Space` property (including U+00A0, U+2003, U+3000, tab and newline). U+200B and other format characters are kept and counted. Length is counted in code points, not graphemes.
- **Falsifier.** `"\u00A0hi\u00A0"`, `"\u2003hi\u2003"`, `"\u3000hi\u3000"` and `"\thi\n"` are stored as `"hi"`. `"\u00A0\u3000"` → 422. `"\u200B"` → 201. 100×`e\u0301` (200 code points) → 201, and 101× → 422. 29 ZWJ family emoji (145 code points) → 201.
