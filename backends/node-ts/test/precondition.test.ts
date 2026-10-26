import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIfMatch } from '../src/domain/precondition.ts';

test('missing header and wildcard are "required" (428)', () => {
  assert.equal(parseIfMatch(undefined), null);
  assert.equal(parseIfMatch('*'), null);
  assert.equal(parseIfMatch(' * '), null);
  assert.equal(parseIfMatch(''), null);
});

test('a list containing * is "required" (428)', () => {
  assert.equal(parseIfMatch('"1", *'), null);
  assert.equal(parseIfMatch('*, "1"'), null);
});

test('a strong ETag yields its version; whitespace around entries is trimmed', () => {
  assert.deepEqual(parseIfMatch('"3"'), [3]);
  assert.deepEqual(parseIfMatch(' "12" '), [12]);
  assert.deepEqual(parseIfMatch('"9",\t"1"'), [9, 1]);
  assert.deepEqual(parseIfMatch('"9" ,"1"  '), [9, 1]);
});

test('a list yields every strong entry', () => {
  assert.deepEqual(parseIfMatch('"9", "1"'), [9, 1]);
  assert.deepEqual(parseIfMatch('"8", "9"'), [8, 9]);
});

test('weak, non-canonical, unquoted and junk entries never match', () => {
  for (const h of ['3', 'W/"3"', '"a"', '""', '"-1"', '"01"', '"0"', '"1.0"', '"+1"']) assert.deepEqual(parseIfMatch(h), [], h);
  assert.deepEqual(parseIfMatch('W/"1", "2"'), [2]);
});
