# Team Notes: Python backend

Python 3.14 standard library only (`http.server`, `sqlite3`, `hashlib`, `uuid`, `json`).

- `domain.py`: pure validation and rules (titles, patches, If-Match, timestamps).
- `store.py`: SQLite store; loads `spec/schema.sql` at startup, one shared connection behind a lock.
- `api.py`: routing and the error-precedence pipeline (401, 404, 415, 413, 400, 422, 428, 412).
- `server.py`: `ThreadingHTTPServer` adapter and `main`.

Run: `backends/python/run.sh` (env: `PORT`, default 3004; `DB_PATH`, default `:memory:`).

Test: `python3 -m unittest discover -s backends/python/tests`

Conformance: `BASE_URL=http://localhost:3004 node conformance/run.mjs --strict`

See `BUILD_NOTES.md` for timings and spec ambiguities.
