#!/usr/bin/env bash
# Start the PHP Team Notes backend on $PORT (default 3003) with a fresh SQLite file.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export DB_PATH="${DB_PATH:-/tmp/team-notes-php.sqlite}"
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
# Workers (PROFILE-PHP-1): SQLite file locking + busy_timeout + conditional UPDATE keep writes atomic.
export PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-8}"
exec php -d display_errors=0 -d post_max_size=0 -d upload_max_filesize=0 -d memory_limit=256M \
  -S "127.0.0.1:${PORT:-3003}" "$here/public/index.php"
