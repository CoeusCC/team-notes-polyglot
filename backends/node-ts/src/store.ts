import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { toNote } from './domain/note.ts';
import type { Note, NoteRow } from './domain/note.ts';
import type { NotePatch } from './domain/validation.ts';

// ---- FAULT INJECTION HOOK (single place; read once) ------------------------------------------
// Faults are added later for falsification. Do not implement any now.
// Usage later: `if (fault('name')) { ...deliberately wrong behavior... }` at the call sites.
const FAULT = process.env.FAULT ?? '';
export const fault = (name: string): boolean => FAULT !== '' && FAULT === name;
// ----------------------------------------------------------------------------------------------

export type User = { id: string; name: string };
export type TeamRole = { id: string; name: string; role: 'owner' | 'member' };

const SCHEMA_PATH = new URL('../../../spec/schema.sql', import.meta.url);

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

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
  const qVisible = db.prepare(
    `SELECT n.* FROM notes n JOIN memberships m ON m.team_id = n.team_id
     WHERE n.id = ? AND m.user_id = ? AND n.deleted_at IS NULL`);
  const qById = db.prepare('SELECT * FROM notes WHERE id = ?');
  const qInsert = db.prepare(
    `INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const qUpdate = db.prepare(
    `UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body),
       version = version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL`);
  const qDelete = db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');

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
    listNotes(teamId: string): Note[] {
      return (qList.all(teamId) as NoteRow[]).map(toNote);
    },
    /** The note, only if it is live and the user is in its team. Otherwise null (same as absent). */
    visibleNote(noteId: string, userId: string): Note | null {
      const row = qVisible.get(noteId, userId) as NoteRow | undefined;
      return row ? toNote(row) : null;
    },
    insertNote(n: Note): void {
      qInsert.run(n.id, n.teamId, n.authorId, n.title, n.body, n.version, n.createdAt, n.updatedAt);
    },
    patchNote(noteId: string, patch: NotePatch, now: Date): Note | null {
      const res = qUpdate.run(patch.title ?? null, patch.body ?? null, now.toISOString(), noteId);
      if (Number(res.changes) === 0) return null;
      return toNote(qById.get(noteId) as NoteRow);
    },
    softDeleteNote(noteId: string, now: Date): void {
      qDelete.run(now.toISOString(), noteId);
    },
    close(): void { db.close(); },
  };
}
