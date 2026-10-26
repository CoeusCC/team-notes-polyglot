# Path B: rebuilt from the spec alone

Each backend was built by an independent Claude Sonnet 5.5 agent in an isolated git worktree. The agents could read `spec/`, `conformance/`, `docs/adr/`, `AGENTS.md` and the ub-mode skill, but **not** `backends/node-ts` or each other's code. Each recorded a conformance run **before making any fix** (`FIRST_RUN.txt`). Claude (the orchestrator) re-ran every backend independently after merging.

| Backend | Stack | First run (before fixes) | Final | Fix iterations | Wall clock to green | Ambiguities logged |
|---|---|---|---|---|---|---|
| node-ts (reference) | Node 26, node:http, node:sqlite | Tier 2: 37/45 (red first, by design) | 45/45 | 1 | built with the spec | — |
| deno | Deno 2.9, Deno.serve, node:sqlite | **45/45** | 45/45 | 0 | ~2.5 min | 8 |
| python | stdlib http.server + sqlite3 | **45/45** | 45/45 | 0 | ~3 min | 4+ |
| php | PHP 8.5 built-in server + PDO sqlite | **45/45** | 45/45 | 0 | ~3 min | 9 |
| rust | axum + rusqlite (bundled) | **45/45** | 45/45 | 0 | ~4 min (~8 with docs) | 9 |

All four rebuilds started at 15:36 CDT, from spec 0.2.0 (tiers 1–2 ratified, 22 ACs, 45 cases).

## What the rebuilds disagreed on (the suite didn't pin these)
These are places where independent builders made different, equally conformant choices. That is direct evidence of where the ACs are still incomplete:

| Topic | deno | python | php | rust |
|---|---|---|---|---|
| Weak/list `If-Match` | 412 | matches any tag in the list; a list with `*` → 428 | judgment | 412 |
| Invalid `?archived=` | treated as false | live list | judgment | treated as false |
| Empty body, no Content-Type | 400 | — | judgment | — |
| Unknown route, no token | 404 after 401 | 404 after 401 | judgment | 401 |
| `errors[].field` for a non-object body | `(body)` | — | judgment | `$` |

Grok (Speck) is drafting adversarial cases for these in a separate file. Patrick decides each one, and then it becomes a ratified card.

Per-backend detail: `backends/<b>/FIRST_RUN.txt`, `FINAL_RUN.txt`, `BUILD_NOTES.md`.

## Cross-model replication (Grok)
Grok (Speck) independently built Python, Deno and PHP backends from spec 0.2.0, starting at 15:35 CDT, on branches `origin/grok/backend-{python,deno,php}`. Claude, not Grok, ran the conformance suite against them. They're kept on their own branches, not merged, because they duplicate the merged languages.

| Backend (Grok) | Branch head | Conformance (run by Claude) |
|---|---|---|
| grok-python | `94b14f9` | **45/45** cases · 22/22 ACs |
| grok-deno | `9dc0514` | **45/45** cases · 22/22 ACs |
| grok-php | `d8dae7b` | **45/45** cases · 22/22 ACs |

**8 independent implementations from 2 model families, all 45/45** against one spec and suite. Evidence: `evidence/grok-*.txt` and `evidence/grok-*.json`.
