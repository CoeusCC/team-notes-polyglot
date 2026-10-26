import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNote, newNoteFields } from '../src/domain/note.ts';

test('toNote maps a row to exactly the Note shape', () => {
  const row = { seq: 3, id: 'i', team_id: 't', author_id: 'a', title: 'T', body: 'B', version: 2, created_at: 'c', updated_at: 'u', deleted_at: null };
  assert.deepEqual(toNote(row), { id: 'i', teamId: 't', authorId: 'a', title: 'T', body: 'B', version: 2, createdAt: 'c', updatedAt: 'u' });
});

test('newNoteFields starts at version 1 with equal timestamps', () => {
  const n = newNoteFields({ id: 'i', teamId: 't', authorId: 'a', title: 'T', body: '' }, new Date('2026-01-02T03:04:05.678Z'));
  assert.equal(n.version, 1);
  assert.equal(n.createdAt, '2026-01-02T03:04:05.678Z');
  assert.equal(n.updatedAt, n.createdAt);
});
