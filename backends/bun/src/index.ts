import { createServer } from 'node:http';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

const db = openDb(process.env.DB_PATH ?? ':memory:', process.env.SCHEMA_PATH ?? new URL('../spec/schema.sql', import.meta.url).pathname);
const app = createApp(db);
const port = Number(process.env.PORT ?? 3000);
const MAX_READ = 64 * 1024 * 1024;

// node:http (not Bun.serve) so the request target arrives verbatim: Bun.serve's req.url resolves dot segments (AUTHN-4).
const server = createServer({ requireHostHeader: false }, async (nreq, nres) => {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const c of nreq) {
      total += c.length;
      if (total <= MAX_READ) chunks.push(c as Buffer);
    }
    // rawHeaders keeps repeated headers separate; Headers.append joins them with ", " which the app rejects for Authorization.
    const headers = new Headers();
    for (let i = 0; i < nreq.rawHeaders.length; i += 2) headers.append(nreq.rawHeaders[i]!, nreq.rawHeaders[i + 1]!);
    const method = (nreq.method ?? 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const req = new Request('http://localhost/', { method, headers, body: hasBody && total > 0 ? Buffer.concat(chunks) : undefined });
    const res = await app(req, nreq.url ?? '/');
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => { out[k] = v; });
    nres.writeHead(res.status, out);
    nres.end(Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    console.error(e);
    if (!nres.headersSent) nres.writeHead(500);
    nres.end();
  }
});
server.listen(port, '0.0.0.0', () => console.log(`team-notes (bun) listening on ${port}`));
