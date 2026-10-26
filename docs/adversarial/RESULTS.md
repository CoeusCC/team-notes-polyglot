# Adversarial cases: results on the four backends

Run on main at the time of writing. All four backends pass the ratified suite (45/45, 22/22 ACs). These 29 cases are proposed, not ratified; the expected values are the reviewer's recommendation, so a failure marks a place where the backends disagree with that recommendation, not a bug. Each decision belongs to Patrick. See `questions.md`.

Run: `CASES=conformance/adversarial.cases.json BASE_URL=http://localhost:PORT node conformance/adversarial-run.mjs`

| Backend | Passed | Failing groups |
|---|---|---|
| node-ts | 18/29 | If-Match list containing the current tag, list with `*`, `?archived=` bad values (4), empty body (3), unknown route without a token (2) |
| deno | 20/29 | list with `*`, `?archived=` bad values (4), `errors[].field` for non-object bodies (4) |
| php | 20/29 | list with `*`, `?archived=` bad values (4), `errors[].field` for non-object bodies (4) |
| python | 25/29 | `?archived=` bad values (4) |

Whitespace trimming and code-point counting (question g) pass on all four. Verdicts come from the runner, not from Grok.
