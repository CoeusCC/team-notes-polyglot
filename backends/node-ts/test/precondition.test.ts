import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIfMatch } from '../src/domain/precondition.ts';

test('missing header and wildcard are "required" (428)', () => {
  assert.equal(parseIfMatch(undefined), null);
  assert.equal(parseIfMatch('*'), null);
  assert.equal(parseIfMatch(' * '), null);
});

test('a strong ETag yields its version', () => {
  assert.equal(parseIfMatch('"3"'), 3);
  assert.equal(parseIfMatch(' "12" '), 12);
});

test('anything else can never match (version 0 does not exist)', () => {
  for (const h of ['3', 'W/"3"', '"a"', '"1", "2"', '""', '"-1"']) assert.equal(parseIfMatch(h), 0, h);
});
