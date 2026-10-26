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

const call = async (method: string, path: string, token: string, body?: string, ct = 'application/json') => {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': ct }, body });
  const text = await res.text();
  return { res, text, json: text ? JSON.parse(text) : null };
};

test('owner manages membership; members get 403, outsiders 404', async () => {
  const made = await call('POST', '/teams', 'tok_alice', JSON.stringify({ id: 'unit-team', name: ' Unit ' }));
  assert.equal(made.res.status, 201);
  assert.deepEqual(made.json, { id: 'unit-team', name: 'Unit', role: 'owner' });
  assert.equal((await call('POST', '/teams', 'tok_bob', JSON.stringify({ id: 'unit-team', name: 'x' }))).res.status, 409);

  const outsider = await call('PUT', '/teams/unit-team/members/carol', 'tok_carol');
  assert.equal(outsider.res.status, 404);
  assert.equal(outsider.text, (await call('GET', '/teams/nope-nope', 'tok_carol')).text);

  assert.equal((await call('PUT', '/teams/unit-team/members/bob', 'tok_alice')).json.role, 'member');
  assert.equal((await call('PUT', '/teams/unit-team/members/carol', 'tok_bob')).res.status, 403);
  assert.equal((await call('PUT', '/teams/unit-team/members/ghost', 'tok_alice')).res.status, 422);
  assert.equal((await call('PUT', '/teams/unit-team/members/bob', 'tok_alice', 'x', 'text/plain')).res.status, 415);
  assert.equal((await call('DELETE', '/teams/unit-team/members/alice', 'tok_alice')).res.status, 409);
  assert.equal((await call('DELETE', '/teams/unit-team/members/bob', 'tok_alice')).res.status, 204);
  assert.equal((await call('DELETE', '/teams/unit-team/members/bob', 'tok_alice')).res.status, 204);
  assert.equal((await call('GET', '/teams/unit-team', 'tok_bob')).res.status, 404);
  assert.deepEqual((await call('GET', '/teams/unit-team/members', 'tok_alice')).json.items.map((m: { id: string }) => m.id), ['alice']);
});
