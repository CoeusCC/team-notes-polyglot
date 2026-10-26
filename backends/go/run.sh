#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
docker build -t notes-go -f "$ROOT/backends/go/Dockerfile" "$ROOT" && exec docker run --rm -p ${PORT:-3008}:3000 -e DB_PATH=${DB_PATH:-:memory:} notes-go
