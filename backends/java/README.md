# Team Notes: Java 21 backend

Java 21, `org.xerial:sqlite-jdbc`, Jackson, single-module Maven project with a shaded jar.

    backends/java/run.sh                      # builds in Docker, serves on host port ${PORT:-3009}
    BASE_URL=http://localhost:3009 node conformance/run.mjs --strict

- Container listens on `PORT` (default 3000). `DB_PATH` defaults to `:memory:`.
- Schema is read from `spec/schema.sql` (copied into the image; `SCHEMA_PATH` overrides).
- The conformance suite expects a fresh database: re-running it against the same instance fails
  `teams-carol-only-blue` because earlier runs created teams owned by carol.
- Unit tests: `mvn test` (trimming, code-point counts, surrogate detection).
- HTTP layer: `RawServer` (a small HTTP/1.1 listener that hands `HttpExchange` objects to the handler), see BUILD_NOTES.md for why the stock `HttpServer` was not enough.
