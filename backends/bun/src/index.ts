import { openDb } from './db.ts';
import { createApp } from './app.ts';

const db = openDb(process.env.DB_PATH ?? ':memory:', process.env.SCHEMA_PATH ?? new URL('../spec/schema.sql', import.meta.url).pathname);
const app = createApp(db);
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: 64 * 1024 * 1024,
  fetch: (req) => app(req),
});
console.log(`team-notes (bun) listening on ${server.port}`);
