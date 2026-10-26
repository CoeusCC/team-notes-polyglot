#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
docker build -t notes-java -f "$ROOT/backends/java/Dockerfile" "$ROOT" || exit 1
exec docker run --rm -p ${PORT:-3009}:3000 -e DB_PATH=${DB_PATH:-:memory:} notes-java
