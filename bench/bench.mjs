#!/usr/bin/env node
// Team Notes benchmark harness. Zero dependencies (Node 26 fetch).
import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const { values: o } = parseArgs({
  options: {
    target: { type: 'string', multiple: true },
    runs: { type: 'string', default: '3' },
    duration: { type: 'string', default: '5' },
    concurrency: { type: 'string', default: '32' },
    'contention-workers': { type: 'string', default: '32' },
    scenarios: { type: 'string', default: 'read,list,mixed,contention,authz-under-load,write' },
    json: { type: 'string' },
    md: { type: 'string', default: new URL('./results/latest.md', import.meta.url).pathname },
  },
});
const targets = (o.target ?? []).map((t) => { const i = t.indexOf('='); return { name: t.slice(0, i), url: t.slice(i + 1).replace(/\/$/, '') }; });
if (!targets.length) { console.error('usage: bench.mjs --target name=url [...] [--runs N --duration S --concurrency C --json file]'); process.exit(2); }
const RUNS = +o.runs, DUR = +o.duration * 1000, CONC = +o.concurrency, CW = +o['contention-workers'];
const SCENARIOS = o.scenarios.split(',');
const ALICE = 'tok_alice', CAROL = 'tok_carol';

// ---------- http + stats ----------
function newStats() { return { lat: [], n: 0, bad: 0, net: 0, status: {} }; }
async function call(st, method, path, base, { token = ALICE, headers = {}, body, expect = [200] } = {}) {
  const t0 = performance.now();
  let res, text = '';
  try {
    res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
  } catch (e) {
    st.n++; st.net++; st.bad++; return null;
  }
  st.lat.push(performance.now() - t0);
  st.n++;
  st.status[res.status] = (st.status[res.status] ?? 0) + 1;
  if (!expect.includes(res.status)) st.bad++;
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, etag: res.headers.get('etag'), json };
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);
function summarize(st, secs) {
  const s = [...st.lat].sort((a, b) => a - b);
  return { requests: st.n, rps: st.n / secs, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), errorRate: st.n ? st.bad / st.n : 1, networkErrors: st.net, statuses: st.status };
}
async function workers(n, ms, fn) {
  const end = performance.now() + ms; const t0 = performance.now();
  await Promise.all(Array.from({ length: n }, async (_, i) => { while (performance.now() < end) await fn(i); }));
  return (performance.now() - t0) / 1000;
}
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

async function setupPool(base) {
  const st = newStats(); const ids = [];
  for (let i = 0; i < 50; i++) {
    const r = await call(st, 'POST', '/teams/team-red/notes', base, { body: { title: `pool ${i}`, body: 'x'.repeat(200) }, expect: [201] });
    if (!r || r.status !== 201) throw new Error(`pool setup failed on ${base}: ${r?.status}`);
    ids.push(r.json.id);
  }
  return ids;
}

// ---------- scenarios: each returns {summary + extras} ----------
const S = {
  async read(base, pool) {
    const st = newStats();
    const secs = await workers(CONC, DUR, () => call(st, 'GET', `/notes/${rnd(pool)}`, base));
    return summarize(st, secs);
  },
  async list(base) {
    const st = newStats();
    const secs = await workers(CONC, DUR, () => call(st, 'GET', '/teams/team-red/notes', base));
    return summarize(st, secs);
  },
  async write(base) {
    const st = newStats(); let i = 0;
    const secs = await workers(CONC, DUR, () => call(st, 'POST', '/teams/team-red/notes', base, { body: { title: `w${i++}`, body: 'hello' }, expect: [201] }));
    return summarize(st, secs);
  },
  async mixed(base, pool) {
    const st = newStats(); let conflicts = 0, patches = 0;
    const secs = await workers(CONC, DUR, async () => {
      const id = rnd(pool);
      if (Math.random() < 0.8) return call(st, 'GET', `/notes/${id}`, base);
      const g = await call(st, 'GET', `/notes/${id}`, base);
      if (!g?.etag) return;
      const r = await call(st, 'PATCH', `/notes/${id}`, base, { headers: { 'if-match': g.etag }, body: { body: 'm' + Math.random() }, expect: [200, 412] });
      patches++; if (r?.status === 412) conflicts++;
    });
    return { ...summarize(st, secs), patches, conflictRate: patches ? conflicts / patches : 0 };
  },
  async contention(base) {
    const st = newStats();
    const c = await call(st, 'POST', '/teams/team-red/notes', base, { body: { title: 'contention', body: '' }, expect: [201] });
    const id = c.json.id; const startVersion = c.json.version ?? 1;
    let ok = 0, conflicts = 0, attempts = 0;
    const secs = await workers(CW, DUR, async (w) => {
      const g = await call(st, 'GET', `/notes/${id}`, base);
      if (!g?.etag) return;
      let b = (g.json?.body ?? '') + `[w${w}]`; if (b.length > 50000) b = `[w${w}]`;
      const r = await call(st, 'PATCH', `/notes/${id}`, base, { headers: { 'if-match': g.etag }, body: { body: b }, expect: [200, 412] });
      attempts++; if (r?.status === 200) ok++; else if (r?.status === 412) conflicts++;
    });
    const f = await call(newStats(), 'GET', `/notes/${id}`, base);
    const finalVersion = f?.json?.version;
    const expected = startVersion + ok;
    const lostUpdates = finalVersion === undefined ? NaN : Math.abs(expected - finalVersion);
    return { ...summarize(st, secs), attempts, successfulWrites: ok, conflicts, conflictRate: attempts ? conflicts / attempts : 0, successWritesPerSec: ok / secs, finalVersion, expectedVersion: expected, lostUpdates };
  },
  async 'authz-under-load'(base, pool) {
    const st = newStats(); let leaks = 0;
    const secs = await workers(CONC, DUR, async () => {
      const id = rnd(pool);
      const r = Math.random() < 0.7
        ? await call(st, 'GET', `/notes/${id}`, base, { token: CAROL, expect: [404] })
        : await call(st, 'PATCH', `/notes/${id}`, base, { token: CAROL, headers: { 'if-match': '"1"' }, body: { body: 'leak' }, expect: [404] });
      if (r && r.status !== 404) leaks++;
    });
    return { ...summarize(st, secs), leaks };
  },
};

// ---------- KPI definitions ----------
const KPIS = {
  rps: { label: 'req/s', fmt: (v) => v.toFixed(0) },
  p50: { label: 'p50 ms', fmt: (v) => v.toFixed(2) },
  p95: { label: 'p95 ms', fmt: (v) => v.toFixed(2) },
  p99: { label: 'p99 ms', fmt: (v) => v.toFixed(2) },
  errorRate: { label: 'err %', fmt: (v) => (v * 100).toFixed(2) },
};
const EXTRA = {
  mixed: { conflictRate: ['conflict %', (v) => (v * 100).toFixed(1)] },
  contention: { successWritesPerSec: ['ok writes/s', (v) => v.toFixed(0)], conflictRate: ['conflict %', (v) => (v * 100).toFixed(1)], lostUpdates: ['LOST UPDATES', (v) => String(v)] },
  'authz-under-load': { leaks: ['LEAKS', (v) => String(v)] },
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
function agg(runs, key) {
  const v = runs.map((r) => r[key]).filter((x) => Number.isFinite(x));
  if (!v.length) return { mean: NaN, std: NaN, cv: NaN, values: [] };
  const m = mean(v), s = std(v);
  return { mean: m, std: s, cv: m ? s / m : 0, values: v };
}

// ---------- main ----------
const results = {}; // results[target][scenario] = {runs:[], kpi:{}}
for (const t of targets) {
  results[t.name] = {};
  console.error(`\n== ${t.name} (${t.url})`);
  const h = await fetch(t.url + '/health').catch(() => null);
  if (!h?.ok) { console.error(`  health check failed`); results[t.name].__down = true; continue; }
  try {
    const pool = await setupPool(t.url);
    // warmup (1s, unmeasured)
    const w = newStats(); await workers(CONC, 1000, () => call(w, 'GET', `/notes/${rnd(pool)}`, t.url));
    for (const sc of SCENARIOS) {
      const runs = [];
      for (let r = 0; r < RUNS; r++) {
        const res = await S[sc](t.url, pool); runs.push(res);
        console.error(`  ${sc} run ${r + 1}/${RUNS}: ${res.rps.toFixed(0)} req/s p99=${res.p99?.toFixed(1)}ms err=${(res.errorRate * 100).toFixed(2)}%` + (res.lostUpdates !== undefined ? ` lost=${res.lostUpdates}` : '') + (res.leaks !== undefined ? ` leaks=${res.leaks}` : ''));
      }
      const keys = [...Object.keys(KPIS), ...Object.keys(EXTRA[sc] ?? {})];
      results[t.name][sc] = { runs, kpi: Object.fromEntries(keys.map((k) => [k, agg(runs, k)])) };
    }
  } catch (e) { console.error(`  FAILED: ${e.stack}`); results[t.name].__down = true; results[t.name].__error = String(e); }
}

// ---------- scoring ----------
const TP = [['read', 'rps'], ['list', 'rps'], ['write', 'rps'], ['mixed', 'rps'], ['contention', 'successWritesPerSec']];
const LAT = [['read', 'p99'], ['list', 'p99'], ['write', 'p99'], ['mixed', 'p99'], ['contention', 'p99']];
const val = (b, sc, k) => results[b][sc]?.kpi[k]?.mean;
const scores = {};
for (const t of targets) {
  const b = t.name; const gates = [];
  if (results[b].__down) gates.push('backend down / setup failed');
  for (const sc of SCENARIOS) {
    const r = results[b][sc]; if (!r) continue;
    const lost = r.kpi.lostUpdates, leaks = r.kpi.leaks, err = r.kpi.errorRate.mean;
    if (lost && (lost.values.some((x) => x > 0) || lost.values.length < r.runs.length)) gates.push(`lost updates > 0 (${sc})`);
    if (leaks && leaks.values.some((x) => x > 0)) gates.push(`leaks > 0 (${sc})`);
    if (err > 0.01) gates.push(`error rate ${(err * 100).toFixed(1)}% > 1% (${sc})`);
  }
  const parts = {};
  for (const [sc, k] of TP) {
    const best = Math.max(...targets.map((x) => val(x.name, sc, k) ?? 0)); const v = val(b, sc, k);
    if (best > 0 && v !== undefined) parts[`${sc}.${k}`] = (100 * v) / best;
  }
  for (const [sc, k] of LAT) {
    const vs = targets.map((x) => val(x.name, sc, k)).filter((x) => x > 0); const v = val(b, sc, k);
    if (vs.length && v > 0) parts[`${sc}.${k}`] = (100 * Math.min(...vs)) / v;
  }
  const raw = Object.keys(parts).length ? mean(Object.values(parts)) : 0;
  scores[b] = { raw, final: gates.length ? 0 : raw, gates, parts };
}

// ---------- report ----------
const f = (x, fmt) => (Number.isFinite(x) ? fmt(x) : 'n/a');
let md = `# Team Notes benchmark\n\nGenerated ${new Date().toISOString()} | runs=${RUNS} duration=${o.duration}s concurrency=${CONC} contention-workers=${CW} | node ${process.version}\n\n`;
md += `## Composite score\n\n`;
md += `Formula: mean of ${TP.length} throughput KPIs (req/s for read/list/write/mixed, successful writes/s for contention; each = 100 * value / best backend) and ${LAT.length} latency KPIs (p99 ms of the same scenarios; each = 100 * best backend / value). Gates: any lost update, any leak, or error rate > 1% in any scenario zeroes the score.\n\n`;
md += `| backend | score | raw (pre-gate) | gate failures |\n|---|---|---|---|\n`;
for (const t of targets) md += `| ${t.name} | **${scores[t.name].final.toFixed(1)}** | ${scores[t.name].raw.toFixed(1)} | ${scores[t.name].gates.join('; ') || 'none'} |\n`;
md += `\n## Matrix (mean ± stddev, CV% over ${RUNS} runs)\n\n| scenario | KPI | ${targets.map((t) => t.name).join(' | ')} |\n|---|---|${targets.map(() => '---').join('|')}|\n`;
for (const sc of SCENARIOS) {
  const rows = [...Object.entries(KPIS).map(([k, d]) => [k, d.label, d.fmt]), ...Object.entries(EXTRA[sc] ?? {}).map(([k, [l, fm]]) => [k, l, fm])];
  for (const [k, label, fmt] of rows) {
    const cells = targets.map((t) => {
      const a = results[t.name][sc]?.kpi[k]; if (!a) return 'n/a';
      let cell = `${f(a.mean, fmt)} ± ${f(a.std, fmt)} (${f(a.cv * 100, (v) => v.toFixed(0))}%)`;
      if ((k === 'lostUpdates' || k === 'leaks') && a.mean > 0) cell = `**!!! ${cell} !!!**`;
      return cell;
    });
    md += `| ${sc} | ${label} | ${cells.join(' | ')} |\n`;
  }
}
for (const t of targets) for (const g of scores[t.name].gates) if (/lost|leak/.test(g)) md += `\n> **CORRECTNESS FAILURE: ${t.name}: ${g}**\n`;
console.log(md);
mkdirSync(dirname(o.md), { recursive: true }); writeFileSync(o.md, md);
if (o.json) { mkdirSync(dirname(o.json), { recursive: true }); writeFileSync(o.json, JSON.stringify({ config: { RUNS, DUR, CONC, CW, targets }, results, scores }, null, 1)); }
