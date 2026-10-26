# Team Notes - Deno backend

Independent rebuild of the Team Notes API (tiers 1-2) from `spec/` only.

- Run: `./run.sh` or `deno task start` (env: `PORT` default 3002, `DB_PATH` default `:memory:`).
- Test: `deno task test`. Conformance: `BASE_URL=http://localhost:3002 node conformance/run.mjs --strict`.
- Layout: `domain.ts` (pure validation/rules), `store.ts` (node:sqlite, loads `spec/schema.sql`), `http.ts` (routing, precedence, problem+json), `main.ts` (wiring).
- Permissions: `--allow-net --allow-read --allow-write --allow-env`.
- 413 responses carry `Connection: close`; Deno honors it.
