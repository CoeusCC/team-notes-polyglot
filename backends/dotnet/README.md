# Team Notes: C# / .NET 9 backend

ASP.NET Core minimal hosting plus Microsoft.Data.Sqlite. A single catch-all handler does its own routing, body reading, JSON validation and problem+json output, so ASP.NET defaults (model binding, auto 400s, route normalization) never decide a response.

Run: `backends/dotnet/run.sh` (builds with Docker, serves on host port `${PORT:-3007}`; `DB_PATH` defaults to `:memory:` inside the container).
Check: `BASE_URL=http://localhost:3007 node conformance/run.mjs --strict`.

Design: all SQL goes through one connection under a lock; PATCH uses one conditional `UPDATE ... WHERE version = ?`. The schema is loaded from `spec/schema.sql` (copied into the image). Unit tests were not written (time box).
