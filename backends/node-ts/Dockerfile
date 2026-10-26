# Build with context at repo root: docker build -f backends/node-ts/Dockerfile .
FROM node:26-slim
WORKDIR /app
COPY spec/ /app/spec/
COPY backends/node-ts/ /app/backends/node-ts/
WORKDIR /app/backends/node-ts
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.ts"]
