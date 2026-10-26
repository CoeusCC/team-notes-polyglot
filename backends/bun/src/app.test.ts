import { describe, expect, test } from 'bun:test';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { codePoints, ifMatchVerdict, trimWhiteSpace } from './text.ts';

const app = createApp(openDb(':memory:', new URL('../spec/schema.sql', import.meta.url).pathname));
const call = (method: string, path: string, who: string | null, body?: BodyInit | null, headers: Record<string, string> = {}) =>
  app(new Request('http://x' + path, {
    method, body,
    headers: { ...(who ? { authorization: `Bearer tok_${who}` } : {}), ...(body != null && !headers['content-type'] ? { 'content-type': 'application/json' } : {}), ...headers },
  }));
const mk = async (title = 't', body = '') => (await call('POST', '/teams/team-red/notes', 'alice', JSON.stringify({ title, body }))).json() as Promise<any>;

describe('text', () => {
  test('trim uses Unicode White_Space only', () => {
    expect(trimWhiteSpace(' hi　')).toBe('hi');
    expect(trimWhiteSpace('​')).toBe('​');
    expect(trimWhiteSpace('﻿x')).toBe('﻿x');
  });
  test('code points', () => {
    expect(codePoints('é')).toBe(2);
    expect(codePoints('\u{1F468}‍\u{1F469}‍\u{1F467}')).toBe(5);
  });
  test('If-Match strong list semantics', () => {
    expect(ifMatchVerdict('W/"1"', '"1"')).toBe('nomatch');
    expect(ifMatchVerdict('"9", "1"', '"1"')).toBe('match');
    expect(ifMatchVerdict('"1", *', '"1"')).toBe('wildcard');
    expect(ifMatchVerdict('"01"', '"1"')).toBe('nomatch');
    expect(ifMatchVerdict('1', '"1"')).toBe('nomatch');
    expect(ifMatchVerdict(null, '"1"')).toBe('missing');
  });
});

describe('app', () => {
  test('U+0000 round-trips through SQLite exactly', async () => {
    const r = await call('POST', '/teams/team-red/notes', 'alice', '{"title":"a\\u0000b","body":"keep\\u0000secret-tail"}');
    expect(r.status).toBe(201);
    const n: any = await r.json();
    expect(n.title).toBe('a\u0000b');
    const g: any = await (await call('GET', `/notes/${n.id}`, 'alice')).json();
    expect(g.title).toBe('a\u0000b');
    expect(g.body).toBe('keep\u0000secret-tail');
  });
  test('lone surrogate and invalid UTF-8 are 400', async () => {
    expect((await call('POST', '/teams/team-red/notes', 'alice', '{"title":"\\ud800"}')).status).toBe(400);
    expect((await call('POST', '/teams/team-red/notes', 'alice', new Uint8Array([0x7b, 0x22, 0x74, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]))).status).toBe(400);
  });
  test('error precedence: 401 > 404 > 403 > 415 > 400 > 422 > 428', async () => {
    const n = await mk();
    expect((await call('GET', `/notes/${n.id}`, null)).status).toBe(401);
    expect((await call('PATCH', `/notes/${n.id}`, 'carol', '{nope', { 'content-type': 'text/plain' })).status).toBe(404);
    expect((await call('PATCH', `/notes/${n.id}`, 'alice', '{nope', { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await call('PATCH', `/notes/${n.id}`, 'alice', '{nope')).status).toBe(400);
    expect((await call('PATCH', `/notes/${n.id}`, 'alice', '{"title":""}')).status).toBe(422);
    expect((await call('PATCH', `/notes/${n.id}`, 'alice', '{"title":"x"}')).status).toBe(428);
    expect((await call('PATCH', `/notes/${n.id}`, 'alice', '{"title":"x"}', { 'if-match': '"7"' })).status).toBe(412);
  });
  test('404 bytes are identical for hidden, random and malformed ids', async () => {
    const n = await mk();
    const a = await (await call('GET', `/notes/${n.id}`, 'carol')).text();
    expect(await (await call('GET', '/notes/not-a-uuid', 'carol')).text()).toBe(a);
    expect(await (await call('GET', '/notes/%E0', 'carol')).text()).toBe(a);
    expect(await (await call('GET', '//', 'carol')).text()).toBe(a);
  });
  test('16 parallel PATCHes: exactly one wins', async () => {
    const n = await mk();
    const rs = await Promise.all(Array.from({ length: 16 }, (_, i) =>
      call('PATCH', `/notes/${n.id}`, 'alice', JSON.stringify({ title: `w${i}` }), { 'if-match': '"1"' })));
    const counts: Record<number, number> = {};
    for (const r of rs) counts[r.status] = (counts[r.status] ?? 0) + 1;
    expect(counts).toEqual({ 200: 1, 412: 15 });
    expect(((await (await call('GET', `/notes/${n.id}`, 'alice')).json()) as any).version).toBe(2);
  });
  test('teams: only owner manages members; last owner protected', async () => {
    const id = `t-${Math.random().toString(36).slice(2, 8)}`;
    expect((await call('POST', '/teams', 'alice', JSON.stringify({ id, name: 'X' }))).status).toBe(201);
    expect((await call('PUT', `/teams/${id}/members/bob`, 'alice')).status).toBe(200);
    expect((await call('PUT', `/teams/${id}/members/carol`, 'bob', 'g', { 'content-type': 'text/plain' })).status).toBe(403);
    expect((await call('PUT', `/teams/${id}/members/carol`, 'carol')).status).toBe(404);
    expect((await call('PUT', `/teams/${id}/members/nobody`, 'alice')).status).toBe(422);
    expect((await call('DELETE', `/teams/${id}/members/alice`, 'alice')).status).toBe(409);
    expect((await call('POST', '/teams', 'alice', JSON.stringify({ id, name: ' ' }))).status).toBe(422);
  });
  test('soft delete keeps version; restore bumps it', async () => {
    const n = await mk();
    expect((await call('DELETE', `/notes/${n.id}`, 'bob')).status).toBe(204);
    expect((await call('DELETE', `/notes/${n.id}`, 'bob')).status).toBe(204);
    expect((await call('GET', `/notes/${n.id}`, 'bob')).status).toBe(404);
    const r: any = await (await call('POST', `/notes/${n.id}/restore`, 'bob')).json();
    expect(r.version).toBe(2);
    expect(r.deletedAt).toBeUndefined();
  });
});
