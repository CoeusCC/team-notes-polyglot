"""SQLite store. One shared connection guarded by a lock; each operation is atomic."""
import hashlib
import sqlite3
import threading
import uuid
from pathlib import Path

from domain import now_iso

SCHEMA = Path(__file__).resolve().parent.parent.parent / "spec" / "schema.sql"
NOTE_COLS = "id, team_id, author_id, title, body, version, created_at, updated_at, deleted_at"


def note_dict(r):
    n = {"id": r[0], "teamId": r[1], "authorId": r[2], "title": r[3], "body": r[4],
         "version": r[5], "createdAt": r[6], "updatedAt": r[7]}
    if r[8] is not None:
        n["deletedAt"] = r[8]
    return n


class Store:
    def __init__(self, path=":memory:"):
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._lock = threading.RLock()
        self._db.executescript(SCHEMA.read_text(encoding="utf-8"))

    def user_for_token(self, token):
        h = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self._lock:
            r = self._db.execute("SELECT id, name FROM users WHERE token_hash=?", (h,)).fetchone()
        return {"id": r[0], "name": r[1]} if r else None

    def teams_of(self, user_id):
        with self._lock:
            rows = self._db.execute(
                "SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id=m.team_id "
                "WHERE m.user_id=? ORDER BY t.id", (user_id,)).fetchall()
        return [{"id": a, "name": b, "role": c} for a, b, c in rows]

    def is_member(self, team_id, user_id):
        with self._lock:
            return self._db.execute("SELECT 1 FROM memberships WHERE team_id=? AND user_id=?",
                                    (team_id, user_id)).fetchone() is not None

    def get_note(self, note_id, user_id, include_deleted=False):
        """The note if the user is a member of its team (and it is live, unless include_deleted)."""
        with self._lock:
            r = self._db.execute(
                f"SELECT {NOTE_COLS} FROM notes n WHERE id=? AND EXISTS "
                "(SELECT 1 FROM memberships m WHERE m.team_id=n.team_id AND m.user_id=?)",
                (note_id, user_id)).fetchone()
        if r is None or (r[8] is not None and not include_deleted):
            return None
        return note_dict(r)

    def list_notes(self, team_id, archived):
        cond = "IS NOT NULL" if archived else "IS NULL"
        with self._lock:
            rows = self._db.execute(
                f"SELECT {NOTE_COLS} FROM notes WHERE team_id=? AND deleted_at {cond} ORDER BY seq DESC",
                (team_id,)).fetchall()
        return [note_dict(r) for r in rows]

    def _fetch(self, note_id):
        return note_dict(self._db.execute(f"SELECT {NOTE_COLS} FROM notes WHERE id=?", (note_id,)).fetchone())

    def create_note(self, team_id, author_id, title, body):
        nid, ts = str(uuid.uuid4()), now_iso()
        with self._lock:
            self._db.execute(
                "INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at) "
                "VALUES (?,?,?,?,?,1,?,?)", (nid, team_id, author_id, title, body, ts, ts))
            return self._fetch(nid)

    def update_note(self, note_id, version, fields):
        """Compare-and-set on version. Returns the new note, or None if the version moved."""
        sets = "".join(f"{k}=?, " for k in fields)
        with self._lock:
            cur = self._db.execute(
                f"UPDATE notes SET {sets}version=version+1, updated_at=? "
                "WHERE id=? AND version=? AND deleted_at IS NULL",
                (*fields.values(), now_iso(), note_id, version))
            return self._fetch(note_id) if cur.rowcount else None

    def soft_delete(self, note_id):
        with self._lock:
            self._db.execute("UPDATE notes SET deleted_at=? WHERE id=? AND deleted_at IS NULL",
                             (now_iso(), note_id))

    def restore(self, note_id):
        """Un-deletes (version + 1). A live note is returned unchanged."""
        with self._lock:
            self._db.execute(
                "UPDATE notes SET deleted_at=NULL, version=version+1, updated_at=? "
                "WHERE id=? AND deleted_at IS NOT NULL", (now_iso(), note_id))
            return self._fetch(note_id)

    def role_of(self, team_id, user_id):
        with self._lock:
            r = self._db.execute("SELECT role FROM memberships WHERE team_id=? AND user_id=?",
                                 (team_id, user_id)).fetchone()
        return r[0] if r else None

    def get_team(self, team_id, user_id):
        with self._lock:
            r = self._db.execute(
                "SELECT t.id, t.name, m.role FROM teams t JOIN memberships m ON m.team_id=t.id "
                "WHERE t.id=? AND m.user_id=?", (team_id, user_id)).fetchone()
        return {"id": r[0], "name": r[1], "role": r[2]} if r else None

    def create_team(self, team_id, name, owner_id):
        """Returns the team, or None if the id is taken. Both inserts are one transaction."""
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                if self._db.execute("SELECT 1 FROM teams WHERE id=?", (team_id,)).fetchone():
                    self._db.execute("ROLLBACK")
                    return None
                self._db.execute("INSERT INTO teams (id, name, owner_id) VALUES (?,?,?)", (team_id, name, owner_id))
                self._db.execute("INSERT INTO memberships (team_id, user_id, role) VALUES (?,?,'owner')",
                                 (team_id, owner_id))
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return {"id": team_id, "name": name, "role": "owner"}

    def user(self, user_id):
        with self._lock:
            r = self._db.execute("SELECT id, name FROM users WHERE id=?", (user_id,)).fetchone()
        return {"id": r[0], "name": r[1]} if r else None

    def members(self, team_id):
        with self._lock:
            rows = self._db.execute(
                "SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id=m.user_id "
                "WHERE m.team_id=? ORDER BY m.role='owner' DESC, u.id", (team_id,)).fetchall()
        return [{"id": a, "name": b, "role": c} for a, b, c in rows]

    def add_member(self, team_id, user_id):
        with self._lock:
            self._db.execute("INSERT OR IGNORE INTO memberships (team_id, user_id, role) VALUES (?,?,'member')",
                             (team_id, user_id))

    def remove_member(self, team_id, user_id):
        """Returns False (nothing removed) if that would leave the team without an owner."""
        with self._lock:
            cur = self._db.execute(
                "DELETE FROM memberships WHERE team_id=? AND user_id=? AND (role='member' OR EXISTS "
                "(SELECT 1 FROM memberships o WHERE o.team_id=? AND o.role='owner' AND o.user_id<>?))",
                (team_id, user_id, team_id, user_id))
            if cur.rowcount:
                return True
            return self.role_of(team_id, user_id) is None
