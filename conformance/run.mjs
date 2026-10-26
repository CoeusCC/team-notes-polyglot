#!/usr/bin/env node
// Conformance runner. It runs the data-only cases in cases.json against any backend at BASE_URL
// and validates every response against spec/openapi.yaml.
//
//   BASE_URL=http://localhost:3001 node conformance/run.mjs [--only <alias-or-case-prefix>] [--json out.json] [--strict]
//   node conformance/run.mjs --check     # self-check cases.json against the AC file; no server needed
//
// --strict also fails when a ratified AC has no case ("unverified"). Draft ACs are reported but not required.
//
// Step extras: rawBodyBase64 (exact bytes, e.g. invalid UTF-8), noContract (skip OpenAPI validation, e.g. unknown routes), parallel: N + expectCounts {status: n}.
// It exits 0 only if every case passes. Each case names the AC it falsifies. A failing case refutes that AC.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const strict = args.includes('--strict');
const spec = YAML.parse(readFileSync(join(here, '../spec/openapi.yaml'), 'utf8'));
const { cases, tokens } = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));

// ---- AC catalogue: every card heading, and whether its tier is ratified ------------------------
const acText = readFileSync(join(here, '../spec/acceptance-criteria.md'), 'utf8');
const ratifiedTiers = (acText.match(/^ratified_tiers:\s*"([^"]*)"/m)?.[1] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
const catalogue = {};
let tier = null;
for (const line of acText.split('\n')) {
  const t = line.match(/^## Tier (\d+)/); if (t) tier = t[1];
  const h = line.match(/^#### (NOTES-[A-Z]+-[A-Z]+-\d+)/);
  if (h) catalogue[h[1]] = { tier, ratified: ratifiedTiers.includes(tier) };
}

if (args.includes('--check')) {
  const problems = [];
  const ids = new Set();
  for (const c of cases) {
    if (ids.has(c.id)) problems.push(`duplicate case id ${c.id}`);
    ids.add(c.id);
    if (!catalogue[c.falsifies]) problems.push(`${c.id}: falsifies unknown AC ${c.falsifies}`);
    for (const [i, st] of (c.steps ?? []).entries())
      if (st.expect?.status === undefined && !st.expectCounts) problems.push(`${c.id} step ${i + 1}: no expect.status`);
  }
  const covered = new Set(cases.map((c) => c.falsifies));
  for (const [ac, meta] of Object.entries(catalogue))
    if (!covered.has(ac)) (meta.ratified ? problems : console.log(`note: draft AC ${ac} has no case yet`), meta.ratified && problems.push(`ratified AC ${ac} has no case`));
  for (const p of problems) console.log(`CHECK ${p}`);
  console.log(`check: ${cases.length} cases, ${Object.keys(catalogue).length} ACs (ratified tiers: ${ratifiedTiers.join(',') || 'none'}), ${problems.length} problems`);
  process.exit(problems.length ? 1 : 0);
}

// ---- OpenAPI response validation -------------------------------------------------------------
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'spec', components: spec.components });
const rewriteRefs = (node) =>
  JSON.parse(JSON.stringify(node).replaceAll('"#/components/', '"spec#/components/'));

const operations = Object.entries(spec.paths).flatMap(([template, item]) =>
  ['get', 'post', 'put', 'patch', 'delete'].filter((m) => item[m]).map((m) => ({
    method: m.toUpperCase(),
    regex: new RegExp('^' + template.replace(/\{[^}]+\}/g, '[^/]+') + '$'),
    op: item[m],
  })));

function resolveResponse(resp) {
  if (resp?.$ref) return resp.$ref.split('/').slice(1).reduce((o, k) => o[k], spec);
  return resp;
}

function validateAgainstSpec(method, path, status, contentType, body) {
  const pathOnly = path.split('?')[0];
  const match = operations.find((o) => o.method === method && o.regex.test(pathOnly));
  if (!match) return `no operation in spec for ${method} ${pathOnly}`;
  const resp = resolveResponse(match.op.responses[String(status)]);
  if (!resp) return `status ${status} not declared for ${match.op.operationId}`;
  if (!resp.content) return body === null ? null : `${match.op.operationId} ${status} declares no body`;
  const mediaType = (contentType ?? '').split(';')[0].trim();
  const media = resp.content[mediaType];
  if (!media) return `content-type '${mediaType}' not declared for ${match.op.operationId} ${status}`;
  const validate = ajv.compile(rewriteRefs(media.schema));
  return validate(body) ? null : `schema: ${ajv.errorsText(validate.errors)}`;
}

// ---- Case execution ----------------------------------------------------------------------------
const interpolate = (value, vars) => {
  if (typeof value === 'string') {
    const whole = value.match(/^\$\{([^}]+)\}$/);
    if (whole) return lookup(vars, whole[1]);
    return value.replace(/\$\{([^}]+)\}/g, (_, p) => String(lookup(vars, p)));
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, vars));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, vars)]));
  return value;
};
const lookup = (vars, path) => path.split('.').reduce((o, k) => o?.[k], vars);
const repeat = (s) => s.replace(/<repeat:(\d+):(.)>/gu, (_, n, ch) => ch.repeat(Number(n)));

function subsetMismatch(expected, actual, at = '$') {
  if (Array.isArray(expected)) {
    // Each expected element must subset-match some element of the actual array.
    if (!Array.isArray(actual)) return `${at}: expected array, got ${JSON.stringify(actual)}`;
    for (const [i, e] of expected.entries())
      if (!actual.some((a) => subsetMismatch(e, a) === null)) return `${at}[${i}]: no element matches ${JSON.stringify(e)}`;
    return null;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return `${at}: expected object, got ${JSON.stringify(actual)}`;
    for (const [k, v] of Object.entries(expected)) {
      const m = subsetMismatch(v, actual[k], `${at}.${k}`);
      if (m) return m;
    }
    return null;
  }
  return JSON.stringify(expected) === JSON.stringify(actual)
    ? null : `${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

async function runStep(step, vars) {
  if (step.parallel) {
    // Fire N identical requests at once; check the status distribution (e.g. exactly one 200 under contention).
    const single = { ...step, parallel: undefined, expect: {}, save: undefined };
    const statuses = await Promise.all(Array.from({ length: step.parallel }, () => runStepStatus(single, vars)));
    const counts = {};
    for (const st of statuses) counts[st] = (counts[st] ?? 0) + 1;
    const want = interpolate(step.expectCounts ?? {}, vars);
    return JSON.stringify(Object.fromEntries(Object.entries(counts).sort())) === JSON.stringify(Object.fromEntries(Object.entries(want).sort()))
      ? [] : [`parallel x${step.parallel}: expected status counts ${JSON.stringify(want)}, got ${JSON.stringify(counts)}`];
  }
  return runOne(step, vars);
}

async function runStepStatus(step, vars) {
  const box = {};
  await runOne({ ...step, _status: box }, vars);
  return box.status;
}

async function runOne(step, vars) {
  const headers = { ...interpolate(step.headers ?? {}, vars) };
  const token = step.token ?? (step.as ? tokens[step.as] : null);
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (step.rawBodyBase64 !== undefined) { body = Buffer.from(step.rawBodyBase64, 'base64'); headers['content-type'] ??= 'application/json'; }
  else if (step.rawBody !== undefined) { body = repeat(interpolate(step.rawBody, vars)); headers['content-type'] ??= 'application/json'; }
  else if (step.body !== undefined) {
    body = repeat(JSON.stringify(interpolate(step.body, vars)));
    headers['content-type'] ??= 'application/json';
  }
  const path = interpolate(step.path, vars);
  const res = await fetch(BASE_URL + path, { method: step.method, headers, body });
  if (step._status) step._status.status = res.status;
  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = undefined; } }

  const failures = [];
  const exp = interpolate(step.expect ?? {}, vars);
  if (exp.status !== undefined && res.status !== exp.status)
    failures.push(`status: expected ${exp.status}, got ${res.status} ${text.slice(0, 200)}`);
  for (const [h, v] of Object.entries(exp.headers ?? {})) {
    const actual = res.headers.get(h);
    if (v === true ? actual === null : actual !== String(v)) failures.push(`header ${h}: expected ${v}, got ${actual}`);
  }
  if (exp.json !== undefined) { const m = subsetMismatch(exp.json, json); if (m) failures.push(m); }
  const ids = Array.isArray(json?.items) ? json.items.map((n) => n.id) : [];
  for (const id of [].concat(exp.itemsContain ?? [])) if (!ids.includes(id)) failures.push(`items missing ${id}`);
  for (const id of [].concat(exp.itemsLack ?? [])) if (ids.includes(id)) failures.push(`items unexpectedly contain ${id}`);
  if (exp.bodyEquals !== undefined && text !== exp.bodyEquals)
    failures.push(`body not byte-identical: expected ${exp.bodyEquals.slice(0, 120)}, got ${text.slice(0, 120)}`);
  for (const [field, re] of Object.entries(exp.jsonMatches ?? {}))
    if (!new RegExp(re).test(String(json?.[field]))) failures.push(`${field}=${json?.[field]} does not match /${re}/`);
  if (exp.firstItems) {
    const want = [].concat(exp.firstItems);
    if (JSON.stringify(ids.slice(0, want.length)) !== JSON.stringify(want)) failures.push(`first items: expected ${want}, got ${ids.slice(0, want.length)}`);
  }
  if (exp.noItemMatches && (json?.items ?? []).some((n) => subsetMismatch(exp.noItemMatches, n) === null))
    failures.push(`an item unexpectedly matches ${JSON.stringify(exp.noItemMatches)}`);
  if (exp.itemsExactly) {
    const want = [...exp.itemsExactly].sort(), got = [...ids].sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) failures.push(`items: expected ${want}, got ${got}`);
  }
  for (const field of exp.errorFields ?? []) {
    if (!json?.errors?.some((e) => e.field === field)) failures.push(`errors[] missing field '${field}'`);
  }
  if (json === undefined) failures.push(`body is not JSON: ${text.slice(0, 120)}`);
  else if (step.method !== 'HEAD' && !step.noContract) {
    const err = validateAgainstSpec(step.method, path, res.status, res.headers.get('content-type'), json);
    if (err) failures.push(`contract (NOTES-TECH-CONTRACT-1): ${err}`);
    if (res.status >= 400 && json && json.status !== res.status)
      failures.push(`problem.status ${json.status} != HTTP ${res.status} (NOTES-TECH-ERR-1)`);
  }
  if (step.save) vars[step.save] = json;
  if (step.saveText) vars[step.saveText] = text;
  if (step.saveHeaders) for (const [k, h] of Object.entries(step.saveHeaders)) vars[k] = res.headers.get(h);
  return failures;
}

const selected = cases.filter((c) => !only || c.falsifies.startsWith(only) || c.id.startsWith(only));
const results = [];
for (const c of selected) {
  const vars = { run: Math.random().toString(36).slice(2, 8) };
  let failures = [];
  try {
    for (const [i, step] of c.steps.entries()) {
      const f = await runStep(step, vars);
      if (f.length) { failures = f.map((m) => `step ${i + 1} (${step.method} ${step.path}): ${m}`); break; }
    }
  } catch (e) { failures = [`error: ${e.message}`]; }
  results.push({ id: c.id, falsifies: c.falsifies, passed: failures.length === 0, failures });
  console.log(`${failures.length ? 'FAIL' : 'ok  '} ${c.id} [${c.falsifies}]`);
  for (const f of failures) console.log(`       ${f}`);
}

const byAc = {};
for (const r of results) (byAc[r.falsifies] ??= []).push(r.passed);
const acVerdicts = Object.fromEntries(Object.entries(byAc).map(([ac, ps]) => [ac, ps.every(Boolean) ? 'passed' : 'refuted']));
// An AC with no case gets no verdict: it is "unverified", never silently counted as passing.
const unverified = only ? [] : Object.keys(catalogue).filter((ac) => !byAc[ac] && catalogue[ac].ratified);
for (const ac of unverified) acVerdicts[ac] = 'unverified';
const passed = results.filter((r) => r.passed).length;
const count = (v) => Object.values(acVerdicts).filter((x) => x === v).length;
console.log(`\n${passed}/${results.length} cases passed · ACs: ${count('passed')} passed, ${count('refuted')} refuted, ${count('unverified')} unverified (ratified, no case) · BASE_URL=${BASE_URL}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ baseUrl: BASE_URL, results, acVerdicts }, null, 2));
process.exit(passed === results.length && !(strict && unverified.length) ? 0 : 1);
