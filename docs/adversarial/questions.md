# Seven decisions for Patrick (proposed cases: adversarial.cases.json)
Every case has `"status": "proposed"`. The runner has no status convention, so these live in a separate file and cannot affect the ratified suite.

**a. If-Match with a weak tag or a list.** Options: weak `W/"1"` → 412 (node: any non-`"n"` value is treated as stale; RFC 9110 says If-Match uses strong comparison) or → 200 if weak matches. A list `"9", "1"` → 200 if any tag matches (deno, php and python split on commas; node returns 412 for any list). `"1", *` → 428 or 412. **Recommendation:** weak → 412, a list matches if any member matches, and a list containing `*` → 428. That follows RFC 9110 and keeps CONC-2's no-wildcard rule.

**b. `?archived=` with yes, 1, empty or TRUE.** Options: 422 naming `archived` (the spec enum is `['true','false']`), 400, or treat anything that isn't `true` as false (what all four backends do now, giving 200 with live notes). **Recommendation:** 422 with `errors[].field = "archived"`, because the spec's enum already says other values are invalid. This needs a 422 response added to `listNotes` in openapi.yaml.

**c. An empty body on POST/PATCH.** Options: 400 (empty isn't JSON), 415 (no Content-Type), or 422. ERR-2 says 415 applies only when "a body is sent", so a zero-length body skips 415 and fails parsing. **Recommendation:** 400 whatever the Content-Type is, since that is the literal reading of ERR-2 and it is what the rebuilds converged on.

**d. An unknown route with no token.** Options: 401 (ERR-2 puts 401 first, and AUTHN-1 binds "all paths except health") or 404 (most routers 404 before auth middleware runs). **Recommendation:** 401. It's the literal reading and doesn't reveal the route surface. With a token, an unknown route or verb → 404 (ADR-0003 "Not adopted": no 405).

**e. Does DELETE bump version, ETag or updatedAt?** Options: DELETE leaves version alone and only restore bumps it, or DELETE bumps too. **Recommendation:** DELETE and a repeated DELETE don't change version. Restore from deleted → version+1 and `ETag "2"`, and restoring a live note changes nothing. DEL-2 already implies this, since restore's bump exists to invalidate pre-delete ETags. Still open: should DELETE set updatedAt? I propose no, with only `deletedAt` set. There's no case for that yet.

**f. `errors[].field` for a non-object body.** Options: `"$"` (node-ts, python; JSONPath root, RFC 9535), `"(body)"` (deno, php), or omit `errors[]`. **Recommendation:** `"$"`. It's a real standard, and it already splits 2–2, so one choice has to win.

**g. Trimming and code points.** Options: Unicode White_Space (JS `trim()` and Python `str.strip()` both strip NBSP, U+2003, U+3000, tab and newline) or ASCII-only (PHP `trim()`, which leaves NBSP). No language trims U+200B, since it isn't White_Space. **Recommendation:** strip Unicode White_Space, keep U+200B as a real character (so a title of just ZWSP is valid), and count code points (`é` written as e+U+0301 counts 2, and a ZWJ family emoji counts 5). PHP must use `preg_replace('/^\s+|\s+$/u', …)`.
