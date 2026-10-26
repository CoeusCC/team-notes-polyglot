# Build with context at repo root: docker build -f backends/deno/Dockerfile .
FROM denoland/deno:2.9.0
WORKDIR /app
COPY spec/ /app/spec/
COPY backends/deno/ /app/backends/deno/
WORKDIR /app/backends/deno
# Pre-cache dependencies (node: builtins only, but keeps the lockfile honest)
RUN deno cache --lock=deno.lock main.ts
ENV PORT=3000 DB_PATH=/data/notes.db
EXPOSE 3000
CMD ["deno", "task", "start"]
