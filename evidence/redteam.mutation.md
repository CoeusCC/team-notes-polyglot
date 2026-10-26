# Red team: mutation testing

Tool: Uncle Bob's [mutator](https://github.com/unclebob/mutator) (+ `crapper` checked out beside it), read before running. It was run on **scratch copies** of the backends, never in the repo, so nothing under `backends/` was touched (no `.metrics/` or `target/` created there). Flags: `--no-coverage` (no c8/coverage tooling installed, so every site runs, none are skipped as uncovered), `--max-workers 3`. Raw logs: `evidence/redteam.mutation.node-ts.log`, `evidence/redteam.mutation.python.log`.

| Target | Test command | Mutants | Killed | Survived | Score |
|---|---|---|---|---|---|
| `backends/node-ts/src/domain` (note, precondition, validation) | `npm test --prefix backends/node-ts` | 43 | 42 | 1 | 97.7% |
| `backends/python/domain.py` | `python3 -m unittest discover -s backends/python/tests` | 19 | 17 | 2 | 89.5% |

Caveat (python): the tool's symlink overlay only redirects JS relative imports. The Python test does `sys.path.insert(0, dirname(__file__)/..)`, which resolves through the symlink to the real, unmutated `domain.py`, so the first run showed a false 0% (19/19 survived). The scratch copy of the test was changed to use `os.getcwd()/backends/python` so the overlay is imported. Only the scratch copy was edited. The repo test is untouched.

Only the unit suites were run by the tool. Survivors were then checked against the conformance suite by hand (below).

## Survivors (findings about weak tests)

1. **node-ts `domain/validation.ts:61`, `||` -> `&&`** in `validateCreate`'s `if (errors.length > 0 || title === undefined || body === undefined)`. Not an equivalent mutant: with `&&`, a create with a valid title and an invalid body (e.g. `{"title":"t","body":5}`) returns `ok:true` with `body: undefined`. No node-ts unit test sends a valid title with an invalid body to `validateCreate`. **Killed by conformance**: I applied the mutant to a scratch copy and ran `conformance/run.mjs`: 12 more cases failed than baseline (validate-*, formats-code-points, pin-*, readonly-and-null-bodies). So the HTTP-level suite covers it, but the unit suite does not.
2. **python `domain.py:48`, `>` -> `>=`** in `_check_body` (`len(v) > BODY_MAX`). No test at the exact boundary (100,000 characters must be accepted). Unit tests only try 100,001. **Conformance does not catch it either**: `cases.json` has only `<repeat:100001:b>` for body length, and no 100,000-character case. A real gap in both suites (title has 200/201 boundary cases; body only has the reject side). Applies to every backend.
3. **python `domain.py:30`, `False` -> `True`** in `_encodable` (the `except UnicodeEncodeError` branch). Nothing tests a lone surrogate (`"\ud800"`) in title or body, which the Python backend rejects with 422. `cases.json` has no lone-surrogate case. Related fuzzer finding: node-ts accepts `{"title":"\ud800"}` (201) and the stored value comes back changed, while Python rejects it. The spec does not say which is right, so this behaviour is not pinned by any test.

## Not run
- `store.ts` / `http.ts` (node-ts), the Rust/PHP/Deno backends: the tool was scoped to the pure cores as asked. The fallback `redteam/mutate.mjs` was not needed because `mutator` ran in under a minute.
- Uncovered-site filtering (coverage) was disabled, so the score counts every mutation site.
