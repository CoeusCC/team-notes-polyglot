# Build with context at repo root: docker build -f backends/php/Dockerfile .
# php:8.5-cli already ships pdo_sqlite (verified with `php -m`).
FROM php:8.5-cli
WORKDIR /app
COPY spec/ /app/spec/
COPY backends/php/ /app/backends/php/
ENV PORT=3000 DB_PATH=/data/notes.db PHP_CLI_SERVER_WORKERS=4
EXPOSE 3000
CMD ["sh", "-c", "exec php -d display_errors=0 -d post_max_size=0 -d upload_max_filesize=0 -d memory_limit=256M -S 0.0.0.0:${PORT} /app/backends/php/public/index.php"]
