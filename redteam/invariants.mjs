#!/usr/bin/env node
// Stateful property-based fuzzer for the Team Notes REST service. Zero deps, seeded PRNG.
//   node redteam/invariants.mjs --target node-ts=http://127.0.0.1:3201 [--target ...] --seed 1,2 --ops 1500 [--out evidence/redteam.invariants]
// Invariants (see redteam/README.md): I1 no 5xx, I2 problem+json w/ matching status, I3 no cross-team leak,
// I4 monotonic versions / rejected PATCH leaves state alone, I5 no lost update (+ 16-way burst), I6 deleted semantics,
// I7 ETag == "<version>", I8 unauthenticated never 2xx except /health. Plus M: model/oracle agreement (status codes per ADR-0003 precedence).
import http from 'node:http';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const targets = []; let seeds = [1], OPS = 1000, out = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--target') { const [n, ...u] = argv[++i].split('='); targets.push({ name: n, url: u.join('=') }); }
  else if (argv[i] === '--seed') seeds = argv[++i].split(',').map(Number);
  else if (argv[i] === '--ops') OPS = Number(argv[++i]);
  else if (argv[i] === '--out') out = argv[++i];
}
if (!targets.length) { console.error('need --target name=url'); process.exit(2); }

// ---- seeded PRNG (mulberry32) ----
function rng(seed) { let a = seed >>> 0; const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.int = (n) => Math.floor(f() * n); f.pick = (a) => a[f.int(a.length)]; f.chance = (p) => f() < p;
  f.weighted = (pairs) => { const tot = pairs.reduce((s, p) => s + p[1], 0); let r = f() * tot; for (const [v, w] of pairs) { if ((r -= w) < 0) return v; } return pairs[0][0]; };
  return f; }

const TOK = { alice: 'tok_alice', bob: 'tok_bob', carol: 'tok_carol', none: null, bad: 'nope' };
const TEAM_OF = { alice: 'team-red', bob: 'team-red', carol: 'team-blue' };
const INVS = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'M'];

function request(base, method, path, { token, headers = {}, body, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(base);
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    let buf = null;
    if (body !== undefined) { buf = Buffer.from(body, 'utf8'); h['content-length'] = buf.length; }
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const efin = (e) => setTimeout(() => fin({ error: String(e) }), 150); // a response may still be in flight (early 413 + reset)
    const req = http.request({ host: u.hostname, port: u.port, method, path, headers: h, agent: false, timeout }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c));
      res.on('end', () => { const text = Buffer.concat(ch).toString('utf8'); let json; try { json = JSON.parse(text); } catch { /* */ }
        fin({ status: res.statusCode, headers: res.headers, text, json }); });
      res.on('error', efin);
    });
    req.on('timeout', () => { req.destroy(); fin({ error: 'timeout' }); });
    req.on('error', efin);
    if (buf) req.write(buf); req.end();
  });
}

const HOSTILE_STR = ['', ' ', '   ', '\t\n', '\u0000', 'a\u0000b', '😀', '日本語', '‮', '\ud800', 'é'.normalize('NFD'), "'; DROP TABLE notes;--", '<script>x</script>', '../../etc/passwd', '%00', '__proto__', 'constructor', '{"a":1}'];
const WRONG = [null, 1, 1.5, true, false, [], {}, [1], { a: 1 }, '', 'x'.repeat(201), 12345678901234567890];

async function runOne(target, seed, OPS) {
  const R = rng(seed), base = target.url;
  const checks = Object.fromEntries(INVS.map((i) => [i, 0]));
  const viol = []; const vcount = Object.fromEntries(INVS.map((i) => [i, 0]));
  const trace = []; // {n, desc, noteIdx}
  const notes = []; // model: {id, team, version, deleted, title, body}
  const redIds = new Set();
  let tolerated = 0, opN = 0, burstN = 0, burstOk = 0, reqs = 0, transport = 0;

  const fail = (inv, desc, detail, noteIdx) => {
    vcount[inv]++;
    if (viol.length < 400) {
      const slice = trace.filter((t) => noteIdx !== undefined && t.noteIdx === noteIdx).map((t) => `#${t.n} ${t.desc}`);
      viol.push({ inv, seed, op: opN, desc, detail, minimalSequence: slice.slice(-12), lastOps: trace.slice(-3).map((t) => `#${t.n} ${t.desc}`) });
    }
  };
  const ok = (inv) => { checks[inv]++; };

  // wrapper: issues request and checks global invariants I1,I2,I3,I8 (+I7 on note bodies)
  async function call(caller, method, path, o = {}) {
    const token = o.token !== undefined ? o.token : TOK[caller];
    const r = await request(base, method, path, { ...o, token });
    reqs++;
    const d = `${caller} ${method} ${path}${o.headers?.['if-match'] !== undefined ? ` If-Match:${o.headers['if-match']}` : ''}${o.body !== undefined ? ` body=${o.body.length > 120 ? o.body.slice(0, 120) + `...(${o.body.length}b)` : o.body}` : ''}`;
    r.desc = d;
    if (!r.error && (r.status === 200 || r.status === 201) && (r.json === undefined || r.json === null) && /^\/(notes|teams)/.test(path) && method !== 'HEAD') { fail('M', d, `${r.status} without JSON body: ${r.text.slice(0, 80)}`); r.json = {}; }
    if (r.error && /EPIPE|ECONNRESET/.test(r.error) && (o.body?.length ?? 0) > 1e6) { tolerated++; return r; } // server answered early and reset the socket mid-upload
    if (r.error) { transport++; fail('I1', d, `transport failure: ${r.error}`); return r; }
    ok('I1'); if (r.status >= 500) fail('I1', d, `status ${r.status}: ${r.text.slice(0, 200)}`);
    ok('I2'); if (r.status >= 400 && method === 'HEAD') { /* no body on HEAD */ } else if (r.status >= 400) {
      const ct = r.headers['content-type'] ?? '';
      if (!ct.toLowerCase().startsWith('application/problem+json')) fail('I2', d, `status ${r.status} content-type "${ct}"`);
      else if (!r.json || r.json.status !== r.status) fail('I2', d, `status ${r.status} body.status=${r.json?.status}`);
    }
    // I3: carol must never receive 2xx for a red path nor see red ids in any body
    if (caller === 'carol') {
      ok('I3');
      const touchesRed = /team-red/.test(path) || [...redIds].some((id) => path.includes(id));
      if (r.status < 300 && touchesRed) fail('I3', d, `carol got ${r.status} on team-red path`);
      for (const id of redIds) if (r.text.includes(id)) { fail('I3', d, `team-red id ${id} in carol response`); break; }
    }
    // I8
    if (caller === 'none' || caller === 'bad') {
      ok('I8');
      const isHealth = method === 'GET' && /^\/health\/?(\?.*)?$/.test(path);
      if (r.status < 300 && !isHealth) fail('I8', d, `unauthenticated got ${r.status}`);
    }
    // I7
    if (r.json && typeof r.json === 'object' && 'version' in r.json && 'id' in r.json && r.status < 300) {
      ok('I7'); if (r.headers.etag !== `"${r.json.version}"`) fail('I7', d, `ETag ${r.headers.etag} vs version ${r.json.version}`);
    }
    return r;
  }

  const log = (desc, noteIdx) => trace.push({ n: opN, desc, noteIdx });
  const isMember = (c, team) => TEAM_OF[c] === team;
  const mem = (c) => c === 'alice' || c === 'bob' || c === 'carol';

  // I4 verify: re-GET as a team member and compare with model
  async function verify(i, why) {
    const n = notes[i]; const member = n.team === 'team-red' ? 'alice' : 'carol';
    const g = await call(member, 'GET', `/notes/${n.id}`);
    if (n.deleted) { ok('I6'); if (g.status !== 404) fail('I6', g.desc, `deleted note returned ${g.status} (${why})`, i); return; }
    ok('I4');
    if (g.status !== 200) { fail('I4', g.desc, `expected 200 got ${g.status} (${why})`, i); return; }
    if (g.json.version < n.version) fail('I4', g.desc, `version decreased ${n.version} -> ${g.json.version} (${why})`, i);
    else if (g.json.version !== n.version || g.json.title !== n.title || g.json.body !== n.body) fail('I4', g.desc, `state diverged after ${why}: model v${n.version} "${n.title.slice(0, 30)}" server v${g.json.version} "${String(g.json.title).slice(0, 30)}"`, i);
  }

  // baseline for pre-existing notes (and notes created as a side effect of the probe sweep)
  const pre = {};
  async function baseline() {
    for (const [t, c] of [['team-red', 'alice'], ['team-blue', 'carol']]) for (const arch of [false, true]) {
      const r = await request(base, 'GET', `/teams/${t}/notes${arch ? '?archived=true' : ''}`, { token: TOK[c] });
      for (const it of (r.json?.items ?? [])) { pre[it.id] = true; if (t === 'team-red') redIds.add(it.id); }
    }
  }

  const validTitle = () => R.pick(['hello', '  padded  ', 'Ünï 😀', 'x'.repeat(1 + R.int(200)), '😀'.repeat(1 + R.int(200)), 'a b\tc', 't' + R.int(1e6)]);
  const validBody = () => R.pick(['', 'body text', 'multi\nline\r\n', '😀'.repeat(R.int(50)), 'b'.repeat(R.int(2000)), 'z'.repeat(100000)]);

  // returns {raw, valid(bool|'maybe'), ct?} hostile or valid body generator
  function genBody(isPatch) {
    const k = R.weighted([['valid', 55], ['hostile', 35], ['rawbad', 10]]);
    if (k === 'valid') {
      const o = {}; if (!isPatch || R.chance(0.6)) o.title = validTitle(); if (R.chance(0.5)) o.body = validBody();
      if (isPatch && !('title' in o) && !('body' in o)) o.body = validBody();
      if (!isPatch && !('title' in o)) o.title = validTitle();
      return { raw: JSON.stringify(o), valid: true, obj: o };
    }
    if (k === 'rawbad') return { raw: R.pick(['{', '{"title":', 'null', '[]', '"str"', '123', 'true', '', ' ', '{"title":"a",}', '\u0000', '{"title":"a"}garbage', '{"__proto__":{"title":"x"}}', '[{"title":"x"}]', '{"title":"x","title":"y"}', '{"title":"\\ud800"}']), valid: 'maybe' };
    const o = isPatch && R.chance(0.5) ? {} : { title: 'ok' };
    const m = R.int(9);
    if (m === 0) o.title = R.pick(WRONG);
    else if (m === 1) o.body = R.pick(WRONG.filter((x) => x !== '' && x !== 'x'.repeat(201)));
    else if (m === 2) Object.defineProperty(o, R.pick(['foo', 'id', 'teamId', 'authorId', 'version', 'createdAt', 'updatedAt', 'deletedAt', '__proto__', 'constructor', 'toString', '']), { value: R.pick(WRONG), enumerable: true, writable: true, configurable: true });
    else if (m === 3) o.title = R.pick(['', ' ', '\t\n ', 'x'.repeat(201), '😀'.repeat(201), ' '.repeat(300)]);
    else if (m === 4) o.body = 'q'.repeat(100001);
    else if (m === 5) o.title = null;
    else if (m === 6) return { raw: '{"title":"ok","body":"' + 'x'.repeat(2 * 1024 * 1024 + 10) + '"}', valid: false, big: true };
    else if (m === 7) { o.title = R.pick(HOSTILE_STR); return { raw: JSON.stringify(o), valid: 'maybe' }; }
    else o.extra = { nested: [1, 2, { a: null }] };
    return { raw: JSON.stringify(o), valid: false, obj: o };
  }

  const hostilePaths = (id, redId) => [`/notes/%E0`, `/notes/..`, `/notes/../teams/team-red/notes`, `/notes/`, `/notes//`, `/notes/${id}/`, `/notes/${id}/restore/`, `/notes/${id}%2f`, `/notes/${id}%00`, `/notes/${id}/..`, `/notes/${id}/extra`,
      `/teams//notes`, `/teams/team-red/notes/`, `/teams/team-red/notes//`, `/teams/__proto__/notes`, `/teams/constructor/notes`, `/notes/__proto__`, `/notes/constructor`, `/notes/${'a'.repeat(5000)}`,
      `/teams/${'t'.repeat(5000)}/notes`, `/teams/team-red%2fnotes`, `/teams/team-red/notes?archived=%E0`, `/teams/team-red/notes?archived[]=true`, `/teams/team-red/notes?archived=true&archived=true`, `/notes/${redId}/%2e%2e/${redId}`, `/notes/${redId}?x=%ff`,
      `/teams/%74eam-red/notes`, `/teams/TEAM-RED/notes`, `/me/`, `/me?x=1`, `/teams/`, `/`, `//`, `/health/`, `/health?x=1`, `/notes/%2e%2e%2fteams`, `/notes/${id.toUpperCase()}`, `/notes/${id}%20`, `/notes/%20${id}`, `/%E0%A4%A`];

  function ifMatchFor(n) {
    const kind = R.weighted([['current', 40], ['stale', 15], ['missing', 10], ['star', 8], ['weak', 7], ['garbage', 10], ['future', 5], ['list', 3], ['listcur', 3]]);
    const v = n.version;
    switch (kind) {
      case 'current': return { kind, h: `"${v}"` };
      case 'stale': return { kind, h: `"${Math.max(0, v - 1 - R.int(3))}"`, stale: v - 1 >= 0 };
      case 'future': return { kind, h: `"${v + 1 + R.int(5)}"` };
      case 'missing': return { kind, h: undefined };
      case 'star': return { kind, h: '*' };
      case 'weak': return { kind, h: `W/"${v}"` };
      case 'list': return { kind, h: `"${v + 1}", "${v + 2}"` };
      case 'listcur': return { kind, h: `"${v}", "${v + 1}"` };
      default: return { kind: 'garbage', h: R.pick(['', 'abc', '"abc"', '"-1"', '"1.5"', '99999999999999999999', '"99999999999999999999"', `${v}`, '"', '""', 'W/', 'é', '"0"']) };
    }
  }

  const setNote = (n, j) => { n.version = j.version; n.title = j.title; n.body = j.body; };

  async function opCreate() {
    const caller = R.weighted([['alice', 30], ['bob', 20], ['carol', 20], ['none', 5], ['bad', 5]]);
    const team = R.weighted([['team-red', 45], ['team-blue', 40], ['team-nope', 5], ['__proto__', 3], ['', 2], ['%E0', 2], ['team-red%2f..', 3]]);
    const b = genBody(false);
    const headers = { 'content-type': R.chance(0.05) ? R.pick(['text/plain', 'application/xml', '', 'application/json; charset=utf-8', 'APPLICATION/JSON']) : 'application/json' };
    const ctOk = ['application/json; charset=utf-8', 'APPLICATION/JSON', 'application/json'].includes(headers['content-type']);
    if (headers['content-type'] === '') delete headers['content-type'];
    const path = `/teams/${team}/notes`;
    log(`create ${caller} ${team} ${b.raw.slice(0, 80)}`);
    const r = await call(caller, 'POST', path, { headers, body: b.raw });
    if (r.error) return;
    if (['', '%E0', 'team-red%2f..'].includes(team)) return; // junk path: route-level behaviour unspecified, invariants only
    ok('M');
    const member = mem(caller) && isMember(caller, team);
    if (!mem(caller)) { if (r.status !== 401) fail('M', r.desc, `expected 401 got ${r.status}`); return; }
    if (!member) { if (r.status !== 404) fail('M', r.desc, `non-member create expected 404 got ${r.status}`); return; }
    if (r.status === 201) {
      if (b.valid === false || !ctOk) { fail('M', r.desc, `invalid input accepted (201)`); }
      const n = { id: r.json.id, team, version: r.json.version, deleted: false, title: r.json.title, body: r.json.body };
      if (n.version !== 1) fail('M', r.desc, `new note version ${n.version}`);
      if (b.obj && b.obj.title !== undefined && r.json.title !== String(b.obj.title).trim()) fail('M', r.desc, `title not stored trimmed: ${JSON.stringify(r.json.title)}`);
      if (!r.headers.location?.endsWith(`/notes/${n.id}`)) fail('M', r.desc, `bad Location ${r.headers.location}`);
      notes.push(n); if (team === 'team-red') redIds.add(n.id);
      trace[trace.length - 1].noteIdx = notes.length - 1;
    } else if (b.valid === true && ctOk) fail('M', r.desc, `valid create got ${r.status}`);
    else if (b.valid === false && r.status >= 200 && r.status < 300) fail('M', r.desc, '2xx on invalid');
    else if (!ctOk && r.status < 300) fail('M', r.desc, '2xx on wrong content-type');
  }

  async function opGet() {
    if (!notes.length) return;
    const i = R.int(notes.length), n = notes[i];
    const caller = R.weighted([['alice', 30], ['bob', 25], ['carol', 25], ['none', 8], ['bad', 8]]);
    log(`get ${caller} note#${i}`, i);
    const r = await call(caller, 'GET', `/notes/${n.id}`);
    if (r.error) return; ok('M');
    if (!mem(caller)) { if (r.status !== 401) fail('M', r.desc, `expected 401 got ${r.status}`, i); return; }
    const member = isMember(caller, n.team);
    if (n.deleted || !member) {
      ok('I6'); if (r.status !== 404) fail(n.deleted && member ? 'I6' : 'M', r.desc, `expected 404 got ${r.status}`, i);
      if (!member && r.status === 404) { const g = await call(caller, 'GET', '/notes/00000000-0000-4000-8000-000000000000'); if (g.text !== r.text) fail('M', r.desc, '404 body differs between hidden and absent id (AUTHZ-3)', i); }
      return;
    }
    if (r.status !== 200) return fail('M', r.desc, `expected 200 got ${r.status}`, i);
    ok('I4'); if (r.json.version < n.version) fail('I4', r.desc, `version decreased ${n.version}->${r.json.version}`, i);
    else if (r.json.version !== n.version || r.json.title !== n.title || r.json.body !== n.body) fail('M', r.desc, `GET differs from model (v${n.version} vs v${r.json.version})`, i);
  }

  async function opList() {
    const caller = R.weighted([['alice', 30], ['bob', 25], ['carol', 25], ['none', 5], ['bad', 5]]);
    const team = R.weighted([['team-red', 45], ['team-blue', 45], ['team-x', 10]]);
    const arch = R.weighted([[false, 60], [true, 40]]);
    const q = arch ? R.pick(['?archived=true', '?archived=true&archived=false', '?archived=TRUE&x=%E0']) : R.pick(['', '?archived=false', '?archived=', '?limit=-1']);
    const ambiguousQ = q.includes('archived=false&') || q.includes('&archived=false') || q.includes('x=%E0') || q.includes('TRUE') || q === '?archived='; // duplicate keys / case: spec silent, invariants only
    log(`list ${caller} ${team}${q}`);
    const r = await call(caller, 'GET', `/teams/${team}/notes${q}`);
    if (r.error) return; ok('M');
    if (!mem(caller)) { if (r.status !== 401) fail('M', r.desc, `expected 401 got ${r.status}`); return; }
    if (!isMember(caller, team)) { if (r.status !== 404) fail('M', r.desc, `non-member list expected 404 got ${r.status}`); return; }
    if (ambiguousQ && r.status !== 200) { if (r.status >= 500) return; ok('M'); return; } // 4xx for odd query syntax is legitimate
    if (r.status !== 200 || !Array.isArray(r.json?.items)) return fail('M', r.desc, `expected 200 items, got ${r.status}`);
    const wantArch = q.startsWith('?archived=true');
    if (ambiguousQ) return;
    const got = r.json.items.map((x) => x.id).filter((id) => !pre[id]);
    const want = notes.filter((n) => n.team === team && n.deleted === wantArch).map((n) => n.id);
    ok('I6');
    for (const id of got) { const n = notes.find((x) => x.id === id); if (!n) fail('M', r.desc, `unknown id in list ${id}`); else if (n.deleted && !wantArch) fail('I6', r.desc, `deleted note ${id} in live list`, notes.indexOf(n)); }
    for (const w of want) if (!got.includes(w)) { const idx = notes.findIndex((x) => x.id === w); fail(wantArch ? 'I6' : 'M', r.desc, `${wantArch ? 'deleted note missing from archived' : 'live note missing from list'}: ${w}`, idx); }
    if (got.length !== new Set(got).size) fail('M', r.desc, 'duplicate ids in list');
    for (const it of r.json.items) { if (!!it.deletedAt !== wantArch) { fail('M', r.desc, `deletedAt presence wrong for ${it.id}`); break; } }
  }

  async function opPatch() {
    if (!notes.length) return;
    const i = R.int(notes.length), n = notes[i];
    const caller = R.weighted([['alice', 30], ['bob', 30], ['carol', 20], ['none', 5], ['bad', 5]]);
    const im = ifMatchFor(n); const b = genBody(true);
    const ctBad = R.chance(0.05); const headers = { 'content-type': ctBad ? 'text/plain' : 'application/json' };
    if (im.h !== undefined) headers['if-match'] = im.h;
    log(`patch ${caller} note#${i} v${n.version}${n.deleted ? '(deleted)' : ''} ifmatch=${im.kind}:${im.h} ${b.raw.slice(0, 60)}`, i);
    const before = { ...n };
    const r = await call(caller, 'PATCH', `/notes/${n.id}`, { headers, body: b.raw });
    if (r.error) return; ok('M');
    if (!mem(caller)) { if (r.status !== 401) fail('M', r.desc, `expected 401 got ${r.status}`, i); return; }
    if (!isMember(caller, n.team) || n.deleted) { if (r.status !== 404) fail('M', r.desc, `expected 404 got ${r.status}`, i); return; }
    // expected status by ADR-0003 precedence: 415 > 413 > 400/422 > 428 > 412 > 200
    let exp;
    if (ctBad) exp = [415];
    else if (b.big) exp = [413];
    else if (b.valid === false) exp = [422];
    else if (b.valid === 'maybe') exp = null;
    else if (im.kind === 'missing' || im.kind === 'star') exp = [428];
    else if (im.kind === 'current') exp = [200];
    else if (im.kind === 'listcur') exp = [200, 412, 428]; // RFC 9110 list containing the current ETag is legal; spec silent
    else if (im.kind === 'weak' || im.kind === 'list' || im.kind === 'garbage') exp = [412, 428];
    else exp = [412];
    if (exp && !exp.includes(r.status)) fail('M', r.desc, `expected ${exp.join('/')} got ${r.status}`, i);
    if (r.status === 200) {
      ok('I4'); ok('I5');
      if (im.kind !== 'current' && im.kind !== 'listcur' && b.valid !== 'maybe') fail('I5', r.desc, `PATCH applied with If-Match kind=${im.kind} (${im.h}) at v${n.version}`, i);
      if ((im.kind === 'current' || im.kind === 'listcur') && r.json.version !== before.version + 1) fail('I4', r.desc, `200 PATCH version ${before.version} -> ${r.json.version}`, i);
      if (b.valid === true && b.obj) { if (b.obj.title !== undefined && r.json.title !== b.obj.title.trim()) fail('M', r.desc, 'patched title wrong', i); if (b.obj.body !== undefined && r.json.body !== b.obj.body) fail('M', r.desc, 'patched body wrong', i); if (b.obj.title === undefined && r.json.title !== before.title) fail('M', r.desc, 'untouched title changed', i); if (b.obj.body === undefined && r.json.body !== before.body) fail('M', r.desc, 'untouched body changed', i); }
      setNote(n, r.json);
    } else if (r.status === 412 || r.status === 428) {
      if (r.status === 412 && r.headers.etag !== undefined && r.headers.etag !== `"${n.version}"`) fail('M', r.desc, `412 ETag ${r.headers.etag} != current "${n.version}"`, i);
      await verify(i, `${r.status} PATCH`);
    } else if (r.status >= 400) await verify(i, `${r.status} PATCH`);
  }

  async function opDelete() {
    if (!notes.length) return;
    const i = R.int(notes.length), n = notes[i];
    const caller = R.weighted([['alice', 30], ['bob', 30], ['carol', 20], ['none', 5], ['bad', 5]]);
    log(`delete ${caller} note#${i}`, i);
    const r = await call(caller, 'DELETE', `/notes/${n.id}`, R.chance(0.1) ? { headers: { 'content-type': 'application/json' }, body: '{"junk":' } : {});
    if (r.error) return; ok('M');
    if (!mem(caller)) { if (r.status !== 401) fail('M', r.desc, `expected 401 got ${r.status}`, i); return; }
    if (!isMember(caller, n.team)) { if (r.status !== 404) fail('M', r.desc, `expected 404 got ${r.status}`, i); return; }
    if (r.status !== 204) return fail('M', r.desc, `expected 204 got ${r.status}`, i);
    n.deleted = true;
    if (R.chance(0.5)) await verify(i, 'DELETE');
  }

  async function opRestore() {
    if (!notes.length) return;
    const i = R.int(notes.length), n = notes[i];
    const caller = R.weighted([['alice', 30], ['bob', 30], ['carol', 20], ['none', 5], ['bad', 5]]);
    log(`restore ${caller} note#${i} (model deleted=${n.deleted})`, i);
    const r = await call(caller, 'POST', `/notes/${n.id}/restore`);
    if (r.error) return; ok('M');
    if (!mem(caller)) { if (r.status !== 401) fail('M', r.desc, `expected 401 got ${r.status}`, i); return; }
    if (!isMember(caller, n.team)) { if (r.status !== 404) fail('M', r.desc, `expected 404 got ${r.status}`, i); return; }
    if (r.status !== 200) return fail('M', r.desc, `expected 200 got ${r.status}`, i);
    ok('I4');
    const expV = n.deleted ? n.version + 1 : n.version;
    if (r.json.version !== expV) fail('I4', r.desc, `restore version ${n.version} -> ${r.json.version}, expected ${expV} (deleted=${n.deleted})`, i);
    if (r.json.title !== n.title || r.json.body !== n.body) fail('M', r.desc, 'restore lost content', i);
    n.deleted = false; n.version = r.json.version;
  }

  async function opHostile() {
    const caller = R.weighted([['alice', 25], ['bob', 15], ['carol', 25], ['none', 15], ['bad', 15], ['x', 0]]);
    const id = notes.length ? R.pick(notes).id : 'abc';
    const redId = [...redIds][0] ?? 'team-red';
    const paths = hostilePaths(id, redId);
    const methods = ['GET', 'GET', 'GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS', 'HEAD'];
    const path = R.pick(paths), method = R.pick(methods);
    const headers = {};
    if (R.chance(0.3)) headers['content-type'] = R.pick(['application/json', 'text/plain', 'application/json; charset=é']);
    if (R.chance(0.3)) headers['if-match'] = R.pick(['*', '"1"', 'W/"1"', '"1","2"']);
    const hdrTok = R.chance(0.1) ? R.pick(['', 'Bearer', 'bearer tok_alice', 'Bearer  tok_alice', 'Bearer tok_alice tok_alice', 'Basic dG9rX2FsaWNl', 'tok_alice', 'Bearer TOK_ALICE', 'Bearer tok_alice\t']) : null;
    const b = ['POST', 'PATCH', 'PUT'].includes(method) && R.chance(0.7) ? R.pick(['{}', '{"title":"x"}', 'null', '{"title":"x","body":"\u0000"}']) : undefined;
    log(`hostile ${caller} ${method} ${path.slice(0, 80)}${hdrTok !== null ? ` auth="${hdrTok}"` : ''}`);
    let r;
    if (hdrTok !== null) { r = await call('hdr', method, path, { headers: { ...headers, authorization: hdrTok }, body: b }); }
    else r = await call(caller === 'x' ? 'none' : caller, method, path, { headers, body: b });
    if (r.error) return;
    // custom Authorization header values: tok_alice as Basic/raw must not authenticate. Bearer variants are ambiguous (case/whitespace) so only checked via I8 for none; here:
    if (hdrTok !== null && r.status < 300 && /^(Basic|tok_alice$)/.test(hdrTok)) fail('I8', r.desc, `non-bearer auth scheme accepted: ${hdrTok}`);
    // hostile ops could mutate state if they hit a real note (e.g. DELETE /notes/<id>/ normalised): resync every note on 2xx mutation
    if (r.status < 300 && ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method) && path.includes(id)) await resync();
  }

  async function resync() {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]; const g = await call(n.team === 'team-red' ? 'alice' : 'carol', 'GET', `/notes/${n.id}`);
      if (g.status === 200) { if (n.deleted || g.json.version !== n.version) { n.deleted = false; n.version = g.json.version; n.title = g.json.title; n.body = g.json.body; fail('M', 'hostile resync', `hostile request mutated note#${i}`, i); } }
      else if (g.status === 404 && !n.deleted) { n.deleted = true; fail('M', 'hostile resync', `hostile request deleted note#${i}`, i); }
    }
  }

  async function opBurst() {
    const live = notes.map((n, i) => [n, i]).filter(([n]) => !n.deleted);
    if (!live.length) return;
    const [n, i] = R.pick(live); burstN++;
    const caller = n.team === 'team-red' ? R.pick(['alice', 'bob']) : 'carol';
    const v = n.version; log(`BURST 16x PATCH note#${i} If-Match "${v}"`, i);
    const rs = await Promise.all(Array.from({ length: 16 }, (_, k) => call(caller, 'PATCH', `/notes/${n.id}`, { headers: { 'content-type': 'application/json', 'if-match': `"${v}"` }, body: JSON.stringify({ title: `burst-${seed}-${burstN}-${k}` }) })));
    ok('I5');
    const wins = rs.filter((r) => r.status === 200), others = rs.filter((r) => r.status !== 200 && r.status !== 412);
    if (wins.length !== 1) fail('I5', `burst on note#${i}`, `${wins.length} of 16 same-If-Match PATCHes returned 200 (exactly 1 allowed); statuses=${rs.map((r) => r.status ?? r.error).join(',')}`, i);
    else burstOk++;
    if (others.length) fail('I5', `burst on note#${i}`, `losers must be 412; got ${others.map((r) => r.status ?? r.error).join(',')}`, i);
    const g = await call(caller, 'GET', `/notes/${n.id}`); ok('I4');
    if (g.status === 200) {
      if (g.json.version !== v + wins.length) fail('I4', g.desc, `after burst version ${g.json.version}, expected ${v + wins.length}`, i);
      n.version = g.json.version; n.title = g.json.title; n.body = g.json.body;
    }
  }

  async function audit() {
    for (let i = 0; i < notes.length; i++) await verify(i, 'audit');
    for (const c of ['alice', 'carol']) { const t = c === 'alice' ? 'team-red' : 'team-blue'; await call(c, 'GET', `/teams/${t}/notes`); }
  }

  async function probes() { // deterministic sweep: every hostile path x method x caller, once
    const c = await request(base, 'POST', '/teams/team-red/notes', { token: TOK.alice, headers: { 'content-type': 'application/json' }, body: '{"title":"sacrificial"}' });
    const id = c.json?.id ?? '00000000-0000-4000-8000-000000000000';
    for (const path of hostilePaths(id, id)) for (const method of ['GET', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) for (const caller of ['alice', 'carol', 'none']) {
      opN = 0; log(`probe ${caller} ${method} ${path.slice(0, 60)}`);
      await call(caller, method, path, ['POST', 'PATCH'].includes(method) ? { headers: { 'content-type': 'application/json', 'if-match': '"1"' }, body: '{"title":"p"}' } : {});
    }
  }
  const OPS_T = [[opCreate, 14], [opGet, 14], [opList, 10], [opPatch, 26], [opDelete, 7], [opRestore, 6], [opHostile, 18]];
  const t0 = Date.now();
  await call('none', 'GET', '/health');
  await probes(); await baseline();
  await opCreate(); await opCreate(); await opCreate();
  for (opN = 1; opN <= OPS; opN++) {
    if (opN % 150 === 0) { opN = opN; await opBurst(); }
    if (opN % 500 === 0) await audit();
    await R.weighted(OPS_T)();
    if (notes.length < 3 && opN % 3 === 0) await opCreate();
  }
  await audit(); await opBurst(); await opBurst();
  return { target: target.name, url: base, seed, ops: OPS, requests: reqs, transportFailures: transport, toleratedOversizeResets: tolerated, bursts: burstN, burstsExactlyOneWinner: burstOk, ms: Date.now() - t0, checks, violationCounts: vcount, violations: viol, notesCreated: notes.length };
}

const results = [];
for (const t of targets) for (const s of seeds) {
  process.stderr.write(`[${t.name}] seed ${s} ...\n`);
  const r = await runOne(t, s, OPS);
  results.push(r);
  const bad = Object.entries(r.violationCounts).filter(([, c]) => c).map(([k, c]) => `${k}:${c}`).join(' ') || 'none';
  process.stderr.write(`[${t.name}] seed ${s}: ${r.requests} reqs, violations: ${bad}\n`);
}

// ---- report ----
const md = [];
md.push('# Red team: invariant fuzzer results', '', `Generated ${new Date().toISOString()}. Ops per run: ${OPS}. Seeds: ${seeds.join(', ')}.`, '',
  'Invariants: I1 no 5xx; I2 4xx is problem+json with matching status; I3 no cross-team leak; I4 monotonic versions / rejected PATCH leaves state alone; I5 no lost update (incl. 16-way burst); I6 deleted-note semantics; I7 ETag == "<version>"; I8 no unauthenticated 2xx except /health; M = model/oracle agreement (status codes per ADR-0003 precedence).', '',
  '| backend | seed | requests | ' + INVS.map((i) => `${i} chk/viol`).join(' | ') + ' | bursts ok/total |', '|' + '---|'.repeat(INVS.length + 4));
for (const r of results) md.push(`| ${r.target} | ${r.seed} | ${r.requests} | ` + INVS.map((i) => `${r.checks[i]}/${r.violationCounts[i]}`).join(' | ') + ` | ${r.burstsExactlyOneWinner}/${r.bursts} |`);
md.push('');
for (const r of results) if (r.violations.length) {
  md.push(`## Violations: ${r.target} seed ${r.seed}`, '');
  const seen = new Set();
  for (const v of r.violations) {
    const key = v.inv + v.desc.replace(/[0-9a-f-]{36}/g, 'ID').replace(/\d+/g, 'N').replace(/body=.*/, '').slice(0, 90) + v.detail.slice(0, 20); if (seen.has(key)) continue; seen.add(key);
    md.push(`- **${v.inv}** at op ${v.op}: ${v.detail}`, `  - request: \`${v.desc.replace(/`/g, "'")}\``, `  - sequence touching the note: ${v.minimalSequence.map((s) => '`' + s.replace(/`/g, "'") + '`').join(' → ') || '(none)'}`, `  - repro: \`node redteam/invariants.mjs --target ${r.target}=${r.url} --seed ${r.seed} --ops ${r.ops}\``);
  }
  md.push('');
}
if (!results.some((r) => r.violations.length)) md.push('No violations found.', '');
console.log(md.join('\n'));
if (out) { writeFileSync(out + '.json', JSON.stringify({ generated: new Date().toISOString(), ops: OPS, seeds, results }, null, 2)); writeFileSync(out + '.md', md.join('\n') + '\n'); }
process.exit(results.some((r) => r.violations.length) ? 1 : 0);
