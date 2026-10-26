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

const call = async (method: string, path: string, token?: string, body?: string, headers: Record<string, string> = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...headers },
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

  const p = await call('PATCH', `/notes/${c.json.id}`, 'tok_bob', JSON.stringify({ body: 'x' }), { 'if-match': '"1"' });
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

const create = async (title = 't') => (await call('POST', '/teams/team-red/notes', 'tok_alice', JSON.stringify({ title }))).json;
const patch = (id: string, body: unknown, ifMatch?: string, token = 'tok_alice', headers: Record<string, string> = {}) =>
  call('PATCH', `/notes/${id}`, token, JSON.stringify(body), { ...(ifMatch ? { 'if-match': ifMatch } : {}), ...headers });

test('ETag tracks version on create, get, patch', async () => {
  const c = await call('POST', '/teams/team-red/notes', 'tok_alice', JSON.stringify({ title: 'e' }));
  assert.equal(c.res.headers.get('etag'), '"1"');
  const p = await patch(c.json.id, { title: 'e2' }, '"1"');
  assert.equal(p.res.headers.get('etag'), '"2"');
  assert.equal((await call('GET', `/notes/${c.json.id}`, 'tok_bob')).res.headers.get('etag'), '"2"');
});

test('PATCH: 428 without or with wildcard If-Match, after 422', async () => {
  const n = await create();
  assert.equal((await patch(n.id, { title: 'x' })).res.status, 428);
  assert.equal((await patch(n.id, { title: 'x' }, '*')).res.status, 428);
  assert.equal((await patch(n.id, { authorId: 'x' })).res.status, 422);
});

test('PATCH: stale If-Match is 412 with the current ETag; first writer wins', async () => {
  const n = await create('orig');
  assert.equal((await patch(n.id, { title: 'alice' }, '"1"')).res.status, 200);
  const stale = await patch(n.id, { title: 'bob' }, '"1"', 'tok_bob');
  assert.equal(stale.res.status, 412);
  assert.equal(stale.res.headers.get('etag'), '"2"');
  assert.equal((await call('GET', `/notes/${n.id}`, 'tok_alice')).json.title, 'alice');
});

test('error precedence: 404 before 415 before 400 before 422', async () => {
  const n = await create();
  const text = { 'content-type': 'text/plain; charset=utf-8' };
  assert.equal((await call('PATCH', `/notes/${n.id}`, 'tok_carol', '{nope', text)).res.status, 404);
  assert.equal((await call('PATCH', `/notes/${n.id}`, 'tok_alice', '{nope', text)).res.status, 415);
  assert.equal((await call('PATCH', `/notes/${n.id}`, 'tok_alice', '{nope', { 'content-type': 'Application/JSON; charset=utf-8' })).res.status, 400);
  assert.equal((await call('POST', '/teams/team-red/notes', 'tok_alice', '{"title":"t"}', text)).res.status, 415);
  assert.equal((await call('POST', '/teams/team-red/notes', 'tok_alice', '', { 'content-type': '' })).res.status, 400); // ERR-3: empty body is 400, whatever its type
});

test('delete is soft and idempotent; non-members get 404', async () => {
  const n = await create();
  assert.equal((await call('DELETE', `/notes/${n.id}`, 'tok_carol')).res.status, 404);
  assert.equal((await call('DELETE', `/notes/${n.id}`, 'tok_bob')).res.status, 204);
  assert.equal((await call('DELETE', `/notes/${n.id}`, 'tok_alice')).res.status, 204);
  assert.equal((await call('DELETE', `/notes/${n.id}`, 'tok_carol')).res.status, 404);
  assert.equal((await call('GET', `/notes/${n.id}`, 'tok_alice')).res.status, 404);
  assert.equal((await patch(n.id, { title: 'x' }, '"1"')).res.status, 404);
});

test('restore: version+1, same content, stale ETag then 412, live restore is a no-op', async () => {
  const n = await create('keep');
  await call('DELETE', `/notes/${n.id}`, 'tok_alice');
  assert.equal((await call('POST', `/notes/${n.id}/restore`, 'tok_carol')).res.status, 404);
  const r = await call('POST', `/notes/${n.id}/restore`, 'tok_bob');
  assert.equal(r.res.status, 200);
  assert.equal(r.res.headers.get('etag'), '"2"');
  assert.deepEqual({ t: r.json.title, v: r.json.version, d: 'deletedAt' in r.json }, { t: 'keep', v: 2, d: false });
  assert.equal((await patch(n.id, { title: 'x' }, '"1"')).res.status, 412);
  const again = await call('POST', `/notes/${n.id}/restore`, 'tok_alice');
  assert.deepEqual({ s: again.res.status, v: again.json.version }, { s: 200, v: 2 });
  assert.equal((await call('POST', '/notes/not-a-uuid/restore', 'tok_alice')).res.status, 404);
});

test('archived=true lists only deleted notes, with deletedAt', async () => {
  const live = await create('live');
  const dead = await create('dead');
  await call('DELETE', `/notes/${dead.id}`, 'tok_alice');
  const def = (await call('GET', '/teams/team-red/notes', 'tok_alice')).json.items;
  const arch = (await call('GET', '/teams/team-red/notes?archived=true', 'tok_alice')).json.items;
  assert.ok(def.some((x: { id: string }) => x.id === live.id) && !def.some((x: { id: string }) => x.id === dead.id));
  assert.ok(!arch.some((x: { id: string }) => x.id === live.id));
  assert.match(arch.find((x: { id: string }) => x.id === dead.id).deletedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.ok(def.every((x: object) => !('deletedAt' in x)));
});

test('404 bodies are byte-identical and carry no instance/detail', async () => {
  const n = await create();
  const bodies = await Promise.all([n.id, '00000000-0000-4000-8000-000000000000', 'not-a-uuid'].map(async (id) => {
    const res = await fetch(`${base}/notes/${id}`, { headers: { authorization: 'Bearer tok_carol' } });
    return res.text();
  }));
  assert.equal(new Set(bodies).size, 1);
  assert.ok(!/instance|detail/.test(bodies[0]!));
});

test('null body is 422', async () => {
  const n = await create();
  assert.equal((await patch(n.id, null, '"1"')).res.status, 422);
});
