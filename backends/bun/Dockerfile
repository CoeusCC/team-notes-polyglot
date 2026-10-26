FROM oven/bun:1
WORKDIR /app
COPY spec ./spec
COPY backends/bun/src ./src
ENV PORT=3000 DB_PATH=:memory:
EXPOSE 3000
CMD ["bun", "src/index.ts"]
