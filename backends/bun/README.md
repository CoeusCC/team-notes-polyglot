# Team Notes: Bun backend

Bun (TypeScript) + `Bun.serve` + `bun:sqlite`, built from `spec/`, `conformance/` and `docs/adr/` only.

- Run: `backends/bun/run.sh` (builds the image, serves on `${PORT:-3010}`; `DB_PATH` defaults to `:memory:`).
- The container listens on 3000 and reads `PORT` and `DB_PATH`. The build context is the repo root; the image copies `spec/` for `schema.sql`.
- Conformance: `BASE_URL=http://localhost:3010 node conformance/run.mjs --strict`
- Unit tests (in Docker): `docker build -t notes-bun -f backends/bun/Dockerfile . && docker run --rm notes-bun bun test`

Layout: `src/text.ts` (trim, code points, I-JSON, If-Match), `src/validate.ts` (pure body validation), `src/app.ts` (routing, error order, SQL), `src/db.ts`, `src/index.ts`.
