import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCreate, validatePatch } from '../src/domain/validation.ts';

const fields = (r: { ok: boolean; errors?: { field: string }[] }) => (r.ok ? [] : r.errors!.map((e) => e.field));

test('create: trims title and defaults body to empty string', () => {
  const r = validateCreate({ title: '  hi  ' });
  assert.deepEqual(r, { ok: true, value: { title: 'hi', body: '' } });
});

test('create: accepts 200-char title, rejects 201', () => {
  assert.equal(validateCreate({ title: 'x'.repeat(200) }).ok, true);
  assert.deepEqual(fields(validateCreate({ title: 'x'.repeat(201) })), ['title']);
});

test('create: blank, missing and non-string titles fail on title', () => {
  assert.deepEqual(fields(validateCreate({ title: '   ' })), ['title']);
  assert.deepEqual(fields(validateCreate({})), ['title']);
  assert.deepEqual(fields(validateCreate({ title: 42 })), ['title']);
});

test('create: body limits and type', () => {
  assert.equal(validateCreate({ title: 't', body: 'b'.repeat(100000) }).ok, true);
  assert.deepEqual(fields(validateCreate({ title: 't', body: 'b'.repeat(100001) })), ['body']);
  assert.deepEqual(fields(validateCreate({ title: 't', body: null })), ['body']);
});

test('create: collects every error, including unknown fields', () => {
  assert.deepEqual(fields(validateCreate({ title: '', body: 1, foo: 1, bar: 2 })).sort(), ['bar', 'body', 'foo', 'title']);
});

test('non-object input is a validation error', () => {
  for (const input of [[1, 2], 'x', 5, null]) {
    assert.equal(validateCreate(input).ok, false);
    assert.equal(validatePatch(input).ok, false);
  }
});

test('patch: needs at least one field', () => {
  assert.equal(validatePatch({}).ok, false);
});

test('patch: only supplied fields appear in the value', () => {
  assert.deepEqual(validatePatch({ body: '' }), { ok: true, value: { body: '' } });
  assert.deepEqual(validatePatch({ title: ' a ' }), { ok: true, value: { title: 'a' } });
});

test('patch: validates supplied fields and rejects unknown ones', () => {
  assert.deepEqual(fields(validatePatch({ title: '' })), ['title']);
  assert.deepEqual(fields(validatePatch({ foo: 1 })), ['foo']);
});

test('lengths count Unicode code points, not UTF-16 units', () => {
  assert.equal(validateCreate({ title: '😀'.repeat(200) }).ok, true);
  assert.deepEqual(fields(validateCreate({ title: '😀'.repeat(201) })), ['title']);
  assert.equal(validateCreate({ title: 't', body: '😀'.repeat(100000) }).ok, true);
  assert.deepEqual(fields(validateCreate({ title: 't', body: '😀'.repeat(100001) })), ['body']);
});

test('server-owned fields are rejected by name in create and patch', () => {
  for (const f of ['id', 'teamId', 'authorId', 'version', 'createdAt', 'updatedAt', 'deletedAt']) {
    assert.deepEqual(fields(validateCreate({ title: 't', [f]: 'x' })), [f]);
    assert.deepEqual(fields(validatePatch({ title: 't', [f]: 'x' })), [f]);
  }
});

test('null is not an object', () => {
  assert.equal(validatePatch(null).ok, false);
  assert.equal(validateCreate(null).ok, false);
});
