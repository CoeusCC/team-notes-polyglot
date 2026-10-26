#!/usr/bin/env node
// Scoreboard harness: conformance + bench + falsification + red-team ingest -> evidence/history.jsonl + evidence/scoreboard.md
// Usage: node harness/scoreboard.mjs [--quick] [--backends node-ts,deno,...] [--label "why"]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EV = join(ROOT, 'evidence');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const quick = flag('--quick');
const label = opt('--label', '');
const ALL = ['node-ts', 'deno', 'php', 'python', 'rust'];
const backends = (opt('--backends', '') ? opt('--backends').split(',') : ALL.filter((b) => existsSync(join(ROOT, 'backends', b)))).map((s) => s.trim()).filter(Boolean);
mkdirSync(EV, { recursive: true });

const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, ...o });
  return { rc: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const log = (m) => console.error(`[scoreboard] ${m}`);

// ---- git identity ---------------------------------------------------------------------------
const sha = sh('git', ['rev-parse', '--short', 'HEAD']).out.trim();
const builddigest = sh('bash', ['-c', 'git ls-tree -r HEAD | sha256sum | cut -c1-16']).out.trim();
const dirty = sh('git', ['status', '--porcelain']).out.trim().length > 0;
const startedMs = Date.now();

// ---- AC catalogue (ratified ACs, case counts) -----------------------------------------------
const acText = readFileSync(join(ROOT, 'spec/acceptance-criteria.md'), 'utf8');
const ratTiers = (acText.match(/^ratified_tiers:\s*"([^"]*)"/m)?.[1] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
const ratified = []; { let tier = null; for (const l of acText.split('\n')) {
  const t = l.match(/^## Tier (\d+)/); if (t) tier = t[1];
  const h = l.match(/^#### (NOTES-[A-Z]+-[A-Z]+-\d+)/); if (h && ratTiers.includes(tier)) ratified.push(h[1]); } }
const cases = readJson(join(ROOT, 'conformance/cases.json'))?.cases ?? [];
const caseCount = Object.fromEntries(ratified.map((a) => [a, cases.filter((c) => c.falsifies === a).length]));
const thinAcs = ratified.filter((a) => caseCount[a] < 2).map((a) => ({ ac: a, cases: caseCount[a] }));

// ---- 1. conformance ---------------------------------------------------------------------------
log(`conformance: ${backends.join(',')}`);
const conf = sh('bash', ['scripts/conform-all.sh', '--allow-dirty', ...backends], { timeout: 20 * 60e3 });
const row = { ts: new Date().toISOString(), label, sha, builddigest, dirty, quick, backends: {}, falsification: null, redteam: null };
for (const b of backends) {
  const e = readJson(join(EV, `${b}.json`));
  const fresh = e && e.at && Date.parse(e.at) >= startedMs - 1000;
  const o = row.backends[b] = { conformance: null, bench: null };
  if (!fresh) { o.conformance = { error: 'no fresh conformance output (backend failed to start?)' }; continue; }
  const v = Object.entries(e.acVerdicts);
  const count = (k) => v.filter(([, x]) => x === k).length;
  const refuted = v.filter(([, x]) => x === 'refuted').map(([ac]) => ({
    ac, failingCases: e.results.filter((r) => !r.passed && r.falsifies === ac).map((r) => r.id) }));
  o.conformance = { casesPassed: e.results.filter((r) => r.passed).length, casesTotal: e.results.length,
    acPassed: count('passed'), acRefuted: count('refuted'), acUnverified: count('unverified'), refuted };
}

// ---- 2. bench ---------------------------------------------------------------------------------
const bnames = backends.filter((b) => existsSync(join(ROOT, 'backends', b)));
log(`bench (${quick ? 'quick' : 'full'})`);
const benchArgs = ['bench/run-local.sh', '-b', bnames.join(','), '--runs', quick ? '1' : '3', '--duration', quick ? '2' : '4'];
sh('bash', benchArgs, { timeout: 30 * 60e3 });
const resDir = join(ROOT, 'bench/results');
const newest = existsSync(resDir) ? readdirSync(resDir).filter((f) => /^\d{8}-\d{6}\.json$/.test(f))
  .map((f) => ({ f, t: statSync(join(resDir, f)).mtimeMs })).filter((x) => x.t >= startedMs - 1000).sort((a, b) => b.t - a.t)[0] : null;
const bench = newest ? readJson(join(resDir, newest.f)) : null;
for (const b of backends) {
  const sc = bench?.scores?.[b], res = bench?.results?.[b];
  if (!sc || !res) { row.backends[b].bench = { error: 'no bench result' }; continue; }
  const scen = {}; let lost = 0, leaks = 0;
  for (const [name, r] of Object.entries(res)) {
    if (!r?.kpi) continue;
    scen[name] = { p99: r.kpi.p99?.mean ?? null, rps: r.kpi.rps?.mean ?? null };
    for (const run of r.runs ?? []) { lost += run.lostUpdates ?? 0; leaks += run.leaks ?? 0; }
    lost += r.kpi.lostUpdates?.values?.reduce((a, x) => a + x, 0) ?? 0;
    leaks += r.kpi.leaks?.values?.reduce((a, x) => a + x, 0) ?? 0;
  }
  row.backends[b].bench = { score: sc.final, raw: sc.raw, gates: sc.gates, scenarios: scen, lostUpdates: lost, leaks };
}

// ---- 3. falsification (node-ts only) -------------------------------------------------------------
if (backends.includes('node-ts')) {
  log('falsify');
  const f = sh('bash', ['scripts/falsify.sh'], { timeout: 10 * 60e3 });
  const caught = [], missed = [];
  for (const l of f.out.split('\n')) {
    let m;
    if ((m = l.match(/^CAUGHT (\S+) by (.*)$/))) caught.push({ fault: m[1], by: m[2].trim().split(/\s+/) });
    else if ((m = l.match(/^MISSED (\S+)/))) missed.push(m[1]);
  }
  row.falsification = { backend: 'node-ts', caught: caught.length, missed: missed.length, caughtFaults: caught, missedFaults: missed,
    ...(caught.length + missed.length === 0 ? { error: f.out.trim().split('\n').slice(-3).join(' | ') } : {}) };
}

// ---- 4. red team ingest (optional) ---------------------------------------------------------------
const rt = { invariants: null, mutation: null };
const inv = readJson(join(EV, 'redteam.invariants.json'));
if (inv?.results) {
  const per = {};
  for (const r of inv.results) {
    const p = per[r.target] ??= { violations: 0, byInvariant: {}, examples: {} };
    for (const [k, n] of Object.entries(r.violationCounts ?? {})) if (n) { p.violations += n; p.byInvariant[k] = (p.byInvariant[k] ?? 0) + n; }
    for (const x of r.violations ?? []) p.examples[x.inv] ??= `${x.desc}${x.detail ? ' -> ' + String(x.detail).slice(0, 80) : ''}`;
  }
  rt.invariants = { generated: inv.generated, perBackend: per };
}
for (const f of existsSync(EV) ? readdirSync(EV).filter((x) => /^redteam\.mutation.*\.json$/.test(x)).sort() : []) {
  const m = readJson(join(EV, f)); if (!m) continue;
  const list = m.survivors ?? m.survived ?? (Array.isArray(m.mutants) ? m.mutants.filter((x) => /surviv/i.test(x.status ?? x.result ?? '') || x.killed === false) : []) ?? [];
  const score = m.mutationScore ?? m.score ?? (m.killed != null && m.total ? m.killed / m.total : null);
  rt.mutation = { file: f, generated: m.generated ?? m.at ?? null, score,
    survivors: list.map((x) => (typeof x === 'string' ? x : x.id ?? x.name ?? x.description ?? JSON.stringify(x).slice(0, 100))) };
}
if (rt.invariants || rt.mutation) row.redteam = rt;
row.thinAcs = thinAcs;

// ---- history ------------------------------------------------------------------------------------
const HIST = join(EV, 'history.jsonl');
appendFileSync(HIST, JSON.stringify(row) + '\n');
const rows = readFileSync(HIST, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// ---- queue ---------------------------------------------------------------------------------------
const queue = [];
const add = (prio, action, evidence) => queue.push({ prio, action, evidence });
for (const [b, o] of Object.entries(row.backends))
  for (const r of o.conformance?.refuted ?? [])
    add(1, `Fix backends/${b}: make ${r.ac} pass (write/confirm the failing case first)`, `${b} refutes ${r.ac}; failing cases: ${r.failingCases.join(', ') || '(none listed)'}. Repro: BASE_URL=... node conformance/run.mjs --only <case>`);
for (const [b, o] of Object.entries(row.backends))
  if (o.conformance?.error) add(1, `Make backends/${b} start under scripts/conform-all.sh`, o.conformance.error);
for (const f of row.falsification?.missedFaults ?? [])
  add(2, `Strengthen conformance/cases.json so fault "${f}" is caught (add a case that fails under FAULT=${f})`, `scripts/falsify.sh printed MISSED ${f}`);
for (const [b, p] of Object.entries(rt.invariants?.perBackend ?? {}))
  for (const [k, n] of Object.entries(p.byInvariant))
    add(3, `Fix backends/${b} for red-team invariant ${k} (${n} violation${n > 1 ? 's' : ''})`, `evidence/redteam.invariants.md; e.g. ${p.examples[k] ?? ''}`);
for (const s of rt.mutation?.survivors ?? [])
  add(4, `Add a test that kills mutant: ${s}`, `${rt.mutation.file} lists it as surviving (mutation score ${rt.mutation.score ?? 'n/a'})`);
for (const t of thinAcs)
  add(5, `Add ${2 - t.cases} case(s) to conformance/cases.json for ${t.ac}`, `ratified AC has ${t.cases} case(s); need >= 2`);
for (const [b, o] of Object.entries(row.backends))
  for (const g of o.bench?.gates ?? []) add(6, `Fix bench gate on backends/${b}: ${g}`, `bench score zeroed (raw ${o.bench.raw?.toFixed(1)})`);
for (const [b, o] of Object.entries(row.backends)) {
  const sc = Object.entries(o.bench?.scenarios ?? {}).filter(([, s]) => s.p99 != null).sort((a, c) => c[1].p99 - a[1].p99)[0];
  if (sc) add(7, `Profile backends/${b} scenario "${sc[0]}" (slowest p99)`, `p99 ${sc[1].p99.toFixed(1)} ms, ${Math.round(sc[1].rps)} req/s`);
}
{
  const scores = Object.entries(row.backends).filter(([, o]) => o.bench?.score != null);
  const lead = Math.max(0, ...scores.map(([, o]) => o.bench.score));
  for (const [b, o] of scores) if (lead > 0 && o.bench.score < lead * 0.5)
    add(8, `Raise backends/${b} performance (score under 50% of leader)`, `score ${o.bench.score.toFixed(1)} vs leader ${lead.toFixed(1)}`);
}
queue.sort((a, b) => a.prio - b.prio);

// ---- scoreboard.md ---------------------------------------------------------------------------------
const f1 = (x) => (x == null ? '-' : x.toFixed(1));
const ms = (x) => (x == null ? '-' : x.toFixed(1));
const bs = Object.keys(row.backends);
let md = `# Scoreboard\n\nGenerated ${row.ts} · sha \`${sha}\`${dirty ? ' (dirty)' : ''} · builddigest \`${builddigest}\` · ${quick ? 'quick' : 'full'} run${label ? ` · "${label}"` : ''}\n\nHistory: \`evidence/history.jsonl\` (${rows.length} rows). Re-run: \`node harness/scoreboard.mjs [--quick] [--backends a,b] --label "..."\`\n\n## Latest\n\n`;
md += `| metric | ${bs.join(' | ')} |\n|---|${bs.map(() => '---').join('|')}|\n`;
const line = (name, fn) => { md += `| ${name} | ${bs.map((b) => fn(row.backends[b]) ?? '-').join(' | ')} |\n`; };
line('cases passed', (o) => o.conformance?.casesTotal != null ? `${o.conformance.casesPassed}/${o.conformance.casesTotal}` : 'ERR');
line('ACs passed / refuted / unverified', (o) => o.conformance?.casesTotal != null ? `${o.conformance.acPassed} / ${o.conformance.acRefuted} / ${o.conformance.acUnverified}` : null);
line('refuted ACs', (o) => o.conformance?.refuted?.map((r) => r.ac).join(', ') || 'none');
line('bench score', (o) => o.bench?.score != null ? f1(o.bench.score) : null);
line('gate failures', (o) => o.bench?.gates?.join('; ') || 'none');
line('lost updates / leaks', (o) => o.bench?.lostUpdates != null ? `${o.bench.lostUpdates} / ${o.bench.leaks}` : null);
const scn = [...new Set(bs.flatMap((b) => Object.keys(row.backends[b].bench?.scenarios ?? {})))];
for (const s of scn) line(`${s} p99 ms · req/s`, (o) => { const x = o.bench?.scenarios?.[s]; return x ? `${ms(x.p99)} · ${Math.round(x.rps)}` : null; });
line('red-team violations', (o) => null);
if (rt.invariants) { md = md.replace(/\| red-team violations \|.*\n/, ''); line('red-team violations', (o) => null); md = md.replace(/\| red-team violations \|.*\n$/, `| red-team invariant violations | ${bs.map((b) => rt.invariants.perBackend[b]?.violations ?? '-').join(' | ')} |\n`); }
else md = md.replace(/\| red-team violations \|.*\n$/, '');
md += `\n**Falsification (node-ts):** ${row.falsification ? `${row.falsification.caught} caught / ${row.falsification.missed} missed${row.falsification.missedFaults.length ? ` (missed: ${row.falsification.missedFaults.join(', ')})` : ''}${row.falsification.error ? ` — ${row.falsification.error}` : ''}` : 'not run (node-ts not selected)'}\n`;
md += `\n**Mutation testing:** ${rt.mutation ? `score ${rt.mutation.score ?? 'n/a'}, ${rt.mutation.survivors.length} surviving (${rt.mutation.file})` : 'not present'}\n`;

const last = rows.slice(-10);
md += `\n## Trend (last ${last.length} rows; Δ vs previous row)\n\n| ts | sha | label | ${bs.map((b) => `${b} score | ${b} cases`).join(' | ')} |\n|---|---|---|${bs.map(() => '---|---|').join('')}\n`;
const sgn = (d) => (d == null ? '' : d === 0 ? ' (±0)' : ` (${d > 0 ? '+' : ''}${Number.isInteger(d) ? d : d.toFixed(1)})`);
last.forEach((r, i) => {
  const prev = i > 0 ? last[i - 1] : rows[rows.length - last.length - 1];
  const cells = bs.map((b) => {
    const o = r.backends?.[b], p = prev?.backends?.[b];
    const s = o?.bench?.score, ps = p?.bench?.score, c = o?.conformance?.casesPassed, pc = p?.conformance?.casesPassed;
    return `${s != null ? f1(s) : '-'}${s != null && ps != null ? sgn(s - ps) : ''} | ${c != null ? `${c}/${o.conformance.casesTotal}` : '-'}${c != null && pc != null ? sgn(c - pc) : ''}`;
  });
  md += `| ${r.ts.slice(0, 19)} | ${r.sha}${r.dirty ? '*' : ''} | ${(r.label ?? '').replace(/\|/g, '/')}${r.quick ? ' [quick]' : ''} | ${cells.join(' | ')} |\n`;
});
md += `\nNote: bench scores are relative within a run (best backend = 100 per KPI), so compare scores only between runs with the same backend set and mode.\n`;

md += `\n## Improvement queue\n\nRanked: 1 refuted AC · 2 missed fault · 3 invariant violation · 4 surviving mutant · 5 ratified AC with <2 cases · 6 bench gate · 7 slowest p99 · 8 score <50% of leader.\n\n`;
if (!queue.length) md += '_Nothing to do: all checks green._\n';
queue.forEach((q, i) => { md += `${i + 1}. **[P${q.prio}]** ${q.action}\n   - evidence: ${q.evidence}\n`; });
writeFileSync(join(EV, 'scoreboard.md'), md);
log(`appended row ${rows.length} to evidence/history.jsonl; wrote evidence/scoreboard.md (${queue.length} queue items)`);
console.log(md.split('## Improvement queue')[1] ? '## Improvement queue' + md.split('## Improvement queue')[1].split('\n').slice(0, 24).join('\n') : '');
