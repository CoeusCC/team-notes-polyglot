import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTeamCreate } from '../src/domain/validation.ts';

const fields = (r: { ok: boolean; errors?: { field: string }[] }) => (r.ok ? [] : r.errors!.map((e) => e.field));

test('team create: trims name and accepts a slug', () => {
  assert.deepEqual(validateTeamCreate({ id: 'abc', name: '  Carol Crew  ' }), { ok: true, value: { id: 'abc', name: 'Carol Crew' } });
});

test('team create: slug must match ^[a-z0-9-]{3,40}$', () => {
  assert.equal(validateTeamCreate({ id: 'a-1', name: 'n' }).ok, true);
  assert.equal(validateTeamCreate({ id: 'x'.repeat(40), name: 'n' }).ok, true);
  for (const id of ['AB', 'ab', 'x'.repeat(41), 'Abc', 'a_b', 'a b', 'abc\n', 'é-é', 5, null]) {
    assert.deepEqual(fields(validateTeamCreate({ id, name: 'n' })), ['id'], String(id));
  }
  assert.deepEqual(fields(validateTeamCreate({ name: 'n' })), ['id']);
});

test('team create: name is 1-80 code points after trimming', () => {
  assert.equal(validateTeamCreate({ id: 'abc', name: 'n'.repeat(80) }).ok, true);
  assert.equal(validateTeamCreate({ id: 'abc', name: '😀'.repeat(80) }).ok, true);
  for (const name of ['   ', '', 'n'.repeat(81), 7, undefined]) {
    assert.deepEqual(fields(validateTeamCreate({ id: 'abc', name })), ['name']);
  }
});

test('team create: unknown fields and non-objects fail', () => {
  assert.deepEqual(fields(validateTeamCreate({ id: 'abc', name: 'n', owner: 'bob' })), ['owner']);
  assert.equal(validateTeamCreate([1]).ok, false);
});
