# Team Notes: PHP backend

PHP 8.5, no framework, no Composer deps. PDO sqlite, schema loaded from `spec/schema.sql`.

- `src/Domain.php`: pure validation and rules (code-point lengths, trim, If-Match).
- `src/Store.php`: PDO sqlite store.
- `src/Http.php`: routing, error precedence, problem+json.
- `public/index.php`: router script for the built-in server.

Run: `backends/php/run.sh` (env `PORT`, default 3003; `DB_PATH`, default `/tmp/team-notes-php.sqlite`, recreated at startup).
Unit tests: `php backends/php/tests/run.php`.
Conformance: `BASE_URL=http://localhost:3003 node conformance/run.mjs --strict`.
