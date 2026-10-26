import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { toNote } from './domain/note.ts';
import type { Note, NoteRow } from './domain/note.ts';
import type { NotePatch } from './domain/validation.ts';

// ---- FAULT INJECTION HOOK (single place; read once) ------------------------------------------
// Deliberate defects, enabled by FAULT=<name>, used by scripts/falsify.sh to prove the suite catches them.
// Usage: `if (fault('name')) { ...deliberately wrong behavior... }` at the call sites.
const FAULT = process.env.FAULT ?? '';
export const fault = (name: string): boolean => FAULT !== '' && FAULT === name;
// ----------------------------------------------------------------------------------------------

export type User = { id: string; name: string };
export type TeamRole = { id: string; name: string; role: 'owner' | 'member' };

const SCHEMA_PATH = new URL('../../../spec/schema.sql', import.meta.url);

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export type PatchOutcome =
  | { kind: 'updated'; note: Note }
  | { kind: 'stale'; version: number }
  | { kind: 'gone' };

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  const qUser = db.prepare('SELECT id, name FROM users WHERE token_hash = ?');
  const qTeams = db.prepare(
    `SELECT t.id AS id, t.name AS name, m.role AS role FROM memberships m
     JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.id`);
  const qMember = db.prepare('SELECT 1 AS ok FROM memberships WHERE team_id = ? AND user_id = ?');
  const qList = db.prepare('SELECT * FROM notes WHERE team_id = ? AND deleted_at IS NULL ORDER BY seq DESC');
  const qArchived = db.prepare('SELECT * FROM notes WHERE team_id = ? AND deleted_at IS NOT NULL ORDER BY seq DESC');
  // Includes deleted notes: callers decide what a deleted note means for them.
  const qVisible = db.prepare(
    `SELECT n.* FROM notes n JOIN memberships m ON m.team_id = n.team_id
     WHERE n.id = ? AND m.user_id = ?`);
  const qById = db.prepare('SELECT * FROM notes WHERE id = ?');
  const qInsert = db.prepare(
    `INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const qUpdate = db.prepare(
    `UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body),
       version = version + 1, updated_at = ? WHERE id = ? AND version IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`);
  const qDelete = db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
  const qHardDelete = db.prepare('DELETE FROM notes WHERE id = ?');
  const qRestore = db.prepare(
    `UPDATE notes SET deleted_at = NULL, version = version + ?, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`);

  return {
    userByToken(token: string): User | null {
      return (qUser.get(hashToken(token)) as User | undefined) ?? null;
    },
    teamsOf(userId: string): TeamRole[] {
      return qTeams.all(userId) as TeamRole[];
    },
    isMember(teamId: string, userId: string): boolean {
      return qMember.get(teamId, userId) !== undefined;
    },
    /** Live notes, or with `archived` only deleted ones, newest first. */
    listNotes(teamId: string, archived = false): Note[] {
      return ((archived ? qArchived : qList).all(teamId) as NoteRow[]).map(toNote);
    },
    /** The note (live or deleted), only if the user is in its team. Otherwise null (same as absent). */
    visibleNote(noteId: string, userId: string): Note | null {
      const row = qVisible.get(noteId, userId) as NoteRow | undefined;
      return row ? toNote(row) : null;
    },
    insertNote(n: Note): void {
      qInsert.run(n.id, n.teamId, n.authorId, n.title, n.body, n.version, n.createdAt, n.updatedAt);
    },
    /** Does the note exist at all (any team, live or deleted)? Only for the leak-403 fault. */
    noteExists(noteId: string): boolean {
      return qById.get(noteId) !== undefined;
    },
    /**
     * Check-and-increment in one statement. When nothing changed, re-read to tell
     * "gone" (404) from "stale" (412, carries the current version).
     */
    patchNote(noteId: string, patch: NotePatch, expectedVersions: number[], now: Date): PatchOutcome {
      const res = qUpdate.run(patch.title ?? null, patch.body ?? null, now.toISOString(), noteId, JSON.stringify(expectedVersions));
      const row = qById.get(noteId) as NoteRow | undefined;
      if (Number(res.changes) > 0) return { kind: 'updated', note: toNote(row!) };
      return row && row.deleted_at === null ? { kind: 'stale', version: row.version } : { kind: 'gone' };
    },
    softDeleteNote(noteId: string, now: Date): void {
      // FAULT hard-delete: the row is removed, so the content is lost and a later restore finds nothing.
      if (fault('hard-delete')) { qHardDelete.run(noteId); return; }
      qDelete.run(now.toISOString(), noteId);
    },
    /** Undo a soft delete (version + 1). A live note is left untouched. Returns the note as it now stands. */
    restoreNote(noteId: string, now: Date): Note | null {
      // FAULT restore-keeps-version: restore forgets to bump the version, so pre-delete ETags stay valid.
      qRestore.run(fault('restore-keeps-version') ? 0 : 1, now.toISOString(), noteId);
      const row = qById.get(noteId) as NoteRow | undefined;
      return row ? toNote(row) : null;
    },
    close(): void { db.close(); },
  };
}
