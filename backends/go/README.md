# Team Notes: Go backend

Go 1.23, standard-library `net/http` plus `modernc.org/sqlite` (pure Go, no cgo).

- Run: `backends/go/run.sh` (builds the image from the repo root, serves on `${PORT:-3008}`; `DB_PATH` defaults to `:memory:`).
- Container listens on 3000 and reads `PORT` and `DB_PATH`.
- Tests: run during `docker build` (`go test ./...`), or `docker run --rm -v $PWD/backends/go:/src -w /src golang:1.23 go test ./...` after copying `spec/schema.sql` into the folder.
- Conformance: `BASE_URL=http://localhost:3008 node conformance/run.mjs --strict`.
- `schema.sql` is copied from `spec/` at build time (go:embed) and is git-ignored.
- Routing is hand-rolled on `r.URL.EscapedPath()` (no ServeMux), so `//`, trailing slashes and bad escapes all reach the single 404.
