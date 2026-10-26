import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/http.ts';
import { openStore } from '../src/store.ts';

let server: Server;
let base: string;

before(async () => {
  server = createServer(openStore(':memory:'));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); });

const call = async (method: string, path: string, token?: string, body?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body,
  });
  const text = await res.text();
  return { res, json: text ? JSON.parse(text) : null };
};

test('health is open', async () => {
  const { res, json } = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(json, { status: 'ok' });
});

test('missing token gives problem+json 401', async () => {
  const { res, json } = await call('GET', '/me');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type')!, /^application\/problem\+json/);
  assert.equal(json.status, 401);
});

test('create, read, patch, delete lifecycle', async () => {
  const c = await call('POST', '/teams/team-red/notes', 'tok_alice', JSON.stringify({ title: ' Hello ' }));
  assert.equal(c.res.status, 201);
  assert.equal(c.res.headers.get('location'), `/notes/${c.json.id}`);
  assert.deepEqual({ t: c.json.title, a: c.json.authorId, v: c.json.version }, { t: 'Hello', a: 'alice', v: 1 });

  const p = await call('PATCH', `/notes/${c.json.id}`, 'tok_bob', JSON.stringify({ body: 'x' }));
  assert.equal(p.json.version, 2);
  assert.equal(p.json.title, 'Hello');

  const l = await call('GET', '/teams/team-red/notes', 'tok_bob');
  assert.equal(l.json.items[0].id, c.json.id);

  assert.equal((await call('DELETE', `/notes/${c.json.id}`, 'tok_alice')).res.status, 204);
  assert.equal((await call('GET', `/notes/${c.json.id}`, 'tok_alice')).res.status, 404);
  const l2 = await call('GET', '/teams/team-red/notes', 'tok_alice');
  assert.ok(!l2.json.items.some((n: { id: string }) => n.id === c.json.id));
});

test('non-member and missing note get identical 404 problems', async () => {
  const c = await call('POST', '/teams/team-red/notes', 'tok_alice', JSON.stringify({ title: 's' }));
  const hidden = await call('GET', `/notes/${c.json.id}`, 'tok_carol');
  const missing = await call('GET', '/notes/00000000-0000-4000-8000-000000000000', 'tok_carol');
  assert.equal(hidden.res.status, 404);
  assert.deepEqual(hidden.json, missing.json);
});

test('malformed JSON is 400, wrong shape is 422', async () => {
  assert.equal((await call('POST', '/teams/team-red/notes', 'tok_alice', '{"title": ')).res.status, 400);
  const r = await call('POST', '/teams/team-red/notes', 'tok_alice', '[1]');
  assert.equal(r.res.status, 422);
  assert.ok(r.json.errors.length >= 1);
});

test('unknown route is problem+json 404', async () => {
  const { res, json } = await call('GET', '/nope', 'tok_alice');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type')!, /problem\+json/);
  assert.equal(json.status, 404);
});
