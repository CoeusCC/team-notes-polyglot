import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

export interface Note {
  id: string; teamId: string; authorId: string; title: string; body: string;
  version: number; createdAt: string; updatedAt: string; deletedAt?: string;
}
export interface TeamRole { id: string; name: string; role: "owner" | "member" }
export interface User { id: string; name: string }

type Row = Record<string, string | number | null>;
const toNote = (r: Row): Note => {
  const n: Note = {
    id: r.id as string, teamId: r.team_id as string, authorId: r.author_id as string,
    title: r.title as string, body: r.body as string, version: r.version as number,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
  if (r.deleted_at !== null) n.deletedAt = r.deleted_at as string;
  return n;
};

export class Store {
  private db: DatabaseSync;
  constructor(path: string, schemaSql: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(schemaSql);
  }

  userByToken(token: string): User | null {
    const hash = createHash("sha256").update(token).digest("hex");
    const r = this.db.prepare("SELECT id, name FROM users WHERE token_hash = ?").get(hash) as Row | undefined;
    return r ? { id: r.id as string, name: r.name as string } : null;
  }

  teamsOf(userId: string): TeamRole[] {
    return (this.db.prepare(
      `SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = ? ORDER BY t.id`).all(userId) as Row[])
      .map((r) => ({ id: r.id as string, name: r.name as string, role: r.role as "owner" | "member" }));
  }

  isMember(teamId: string, userId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM memberships WHERE team_id = ? AND user_id = ?").get(teamId, userId);
  }

  listNotes(teamId: string, archived: boolean): Note[] {
    const cond = archived ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
    return (this.db.prepare(`SELECT * FROM notes WHERE team_id = ? AND ${cond} ORDER BY seq DESC`).all(teamId) as Row[]).map(toNote);
  }

  /** Note by id regardless of deletion state. */
  findNote(id: string): Note | null {
    const r = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as Row | undefined;
    return r ? toNote(r) : null;
  }

  createNote(teamId: string, authorId: string, title: string, body: string, now: string): Note {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(id, teamId, authorId, title, body, now, now);
    return this.findNote(id)!;
  }

  /** Compare-and-set update of a live note. Returns null if the version no longer matches. */
  updateNote(id: string, expected: number, fields: { title?: string; body?: string }, now: string): Note | null {
    const r = this.db.prepare(
      `UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body),
         version = version + 1, updated_at = ?
       WHERE id = ? AND version = ? AND deleted_at IS NULL`)
      .run(fields.title ?? null, fields.body ?? null, now, id, expected);
    return r.changes === 1 ? this.findNote(id) : null;
  }

  /** Idempotent soft delete: keeps the original deletedAt if already deleted. */
  softDelete(id: string, now: string): void {
    this.db.prepare("UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, id);
  }

  /** Restores a deleted note (version+1); a live note is returned untouched. */
  restore(id: string, now: string): Note | null {
    this.db.prepare(
      `UPDATE notes SET deleted_at = NULL, version = version + 1, updated_at = ?
       WHERE id = ? AND deleted_at IS NOT NULL`).run(now, id);
    return this.findNote(id);
  }

  getTeam(teamId: string, userId: string): TeamRole | null {
    const r = this.db.prepare(
      `SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id = m.team_id
       WHERE t.id = ? AND m.user_id = ?`).get(teamId, userId) as Row | undefined;
    return r ? { id: r.id as string, name: r.name as string, role: r.role as "owner" | "member" } : null;
  }

  userById(id: string): User | null {
    const r = this.db.prepare("SELECT id, name FROM users WHERE id = ?").get(id) as Row | undefined;
    return r ? { id: r.id as string, name: r.name as string } : null;
  }

  /** Atomically creates the team and its owner membership. False if the id is taken. */
  createTeam(id: string, name: string, ownerId: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT 1 FROM teams WHERE id = ?").get(id)) { this.db.exec("ROLLBACK"); return false; }
      this.db.prepare("INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)").run(id, name, ownerId);
      this.db.prepare("INSERT INTO memberships (team_id, user_id, role) VALUES (?, ?, 'owner')").run(id, ownerId);
      this.db.exec("COMMIT");
      return true;
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  members(teamId: string): { id: string; name: string; role: "owner" | "member" }[] {
    return (this.db.prepare(
      `SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ? ORDER BY (m.role = 'owner') DESC, u.id`).all(teamId) as Row[])
      .map((r) => ({ id: r.id as string, name: r.name as string, role: r.role as "owner" | "member" }));
  }

  /** Idempotent add; an existing membership (any role) is left unchanged. */
  addMember(teamId: string, userId: string): "member" | "owner" {
    this.db.prepare("INSERT OR IGNORE INTO memberships (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamId, userId);
    return (this.db.prepare("SELECT role FROM memberships WHERE team_id = ? AND user_id = ?").get(teamId, userId) as Row).role as "member" | "owner";
  }

  /** Idempotent remove. Returns false (nothing removed) if it would remove the last owner. */
  removeMember(teamId: string, userId: string): boolean {
    const r = this.db.prepare(
      `DELETE FROM memberships WHERE team_id = ? AND user_id = ? AND NOT (
         role = 'owner' AND (SELECT COUNT(*) FROM memberships WHERE team_id = ? AND role = 'owner') <= 1)`)
      .run(teamId, userId, teamId);
    if (r.changes === 1) return true;
    const still = this.db.prepare("SELECT 1 FROM memberships WHERE team_id = ? AND user_id = ?").get(teamId, userId);
    return !still;
  }
}
