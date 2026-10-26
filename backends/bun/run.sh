#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
docker build -t notes-bun -f "$ROOT/backends/bun/Dockerfile" "$ROOT"
exec docker run --rm -p ${PORT:-3010}:3000 -e DB_PATH=${DB_PATH:-:memory:} notes-bun
