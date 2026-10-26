#!/usr/bin/env bash
# Build (context = repo root) and run the .NET backend. PORT = host port (default 3007); DB_PATH is inside the container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
docker build -t notes-dotnet -f "$ROOT/backends/dotnet/Dockerfile" "$ROOT"
exec docker run --rm --name notes-dotnet-run -p "${PORT:-3007}:3000" -e DB_PATH="${DB_PATH:-:memory:}" notes-dotnet
