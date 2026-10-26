# Team Notes: Rust backend

Axum + rusqlite (bundled) implementation of `spec/openapi.yaml` (tiers 1-2).

- `src/domain.rs`: pure validation and rules; JSON is parsed once into typed values (`Title`, `Body`, `NewNote`, `NotePatch`).
- `src/store.rs`: SQLite access; loads `spec/schema.sql` via `include_str!`.
- `src/http.rs`: hand-rolled routing and problem+json responses, so the error precedence (401, 404, 415, 413, 400, 422, 428, 412) is ours.

Run: `./run.sh` (env `PORT`, default 3006; `DB_PATH`, default `:memory:`).
Test: `cargo test`; conformance: `BASE_URL=http://localhost:3006 node ../../conformance/run.mjs --strict`.
