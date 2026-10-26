//! SQLite store. All SQL lives here.
use crate::domain::{NewNote, NotePatch};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use sha2::{Digest, Sha256};

const SCHEMA: &str = include_str!("../../../spec/schema.sql");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub team_id: String,
    pub author_id: String,
    pub title: String,
    pub body: String,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub name: String,
}

pub enum UpdateOutcome {
    Updated(Note),
    /// Current note differs from the expected version (carries the current note).
    Stale(Note),
    Gone,
}

pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

pub fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

const NOTE_COLS: &str = "n.id, n.team_id, n.author_id, n.title, n.body, n.version, n.created_at, n.updated_at, n.deleted_at";

fn note_from(r: &Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        team_id: r.get(1)?,
        author_id: r.get(2)?,
        title: r.get(3)?,
        body: r.get(4)?,
        version: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        deleted_at: r.get(8)?,
    })
}

pub fn user_by_token(c: &Connection, token: &str) -> rusqlite::Result<Option<User>> {
    let hash: String = Sha256::digest(token.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    c.query_row("SELECT id, name FROM users WHERE token_hash = ?", [hash], |r| {
        Ok(User { id: r.get(0)?, name: r.get(1)? })
    })
    .optional()
}

pub fn teams_of(c: &Connection, user_id: &str) -> rusqlite::Result<Vec<Team>> {
    let mut st = c.prepare(
        "SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id = m.team_id \
         WHERE m.user_id = ? ORDER BY t.id",
    )?;
    let rows = st.query_map([user_id], |r| Ok(Team { id: r.get(0)?, name: r.get(1)?, role: r.get(2)? }))?;
    rows.collect()
}

pub fn is_member(c: &Connection, team_id: &str, user_id: &str) -> rusqlite::Result<bool> {
    c.query_row("SELECT 1 FROM memberships WHERE team_id = ? AND user_id = ?", [team_id, user_id], |_| Ok(()))
        .optional()
        .map(|o| o.is_some())
}

/// The note, only if the user belongs to its team. Includes soft-deleted notes.
pub fn note_for_member(c: &Connection, note_id: &str, user_id: &str) -> rusqlite::Result<Option<Note>> {
    c.query_row(
        &format!(
            "SELECT {NOTE_COLS} FROM notes n JOIN memberships m ON m.team_id = n.team_id AND m.user_id = ? WHERE n.id = ?"
        ),
        [user_id, note_id],
        note_from,
    )
    .optional()
}

pub fn list_notes(c: &Connection, team_id: &str, archived: bool) -> rusqlite::Result<Vec<Note>> {
    let cond = if archived { "IS NOT NULL" } else { "IS NULL" };
    let mut st = c.prepare(&format!(
        "SELECT {NOTE_COLS} FROM notes n WHERE n.team_id = ? AND n.deleted_at {cond} ORDER BY n.seq DESC"
    ))?;
    let rows = st.query_map([team_id], note_from)?;
    rows.collect()
}

pub fn insert_note(c: &Connection, team_id: &str, author_id: &str, new: &NewNote) -> rusqlite::Result<Note> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    c.execute(
        "INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
        params![id, team_id, author_id, new.title.as_str(), new.body.as_str(), ts, ts],
    )?;
    Ok(Note {
        id,
        team_id: team_id.into(),
        author_id: author_id.into(),
        title: new.title.as_str().into(),
        body: new.body.as_str().into(),
        version: 1,
        created_at: ts.clone(),
        updated_at: ts,
        deleted_at: None,
    })
}

fn reload(c: &Connection, note_id: &str) -> rusqlite::Result<Option<Note>> {
    c.query_row(&format!("SELECT {NOTE_COLS} FROM notes n WHERE n.id = ?"), [note_id], note_from).optional()
}

/// Compare-and-set update inside a single statement (ADR-0001).
pub fn update_note(c: &Connection, note_id: &str, expected: i64, patch: &NotePatch) -> rusqlite::Result<UpdateOutcome> {
    let changed = c.execute(
        "UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body), \
         version = version + 1, updated_at = ? \
         WHERE id = ? AND version = ? AND deleted_at IS NULL",
        params![patch.title.as_ref().map(|t| t.as_str()), patch.body.as_ref().map(|b| b.as_str()), now(), note_id, expected],
    )?;
    let cur = reload(c, note_id)?;
    Ok(match (changed, cur) {
        (1, Some(n)) => UpdateOutcome::Updated(n),
        (_, Some(n)) if n.deleted_at.is_none() => UpdateOutcome::Stale(n),
        _ => UpdateOutcome::Gone,
    })
}

pub fn soft_delete(c: &Connection, note_id: &str) -> rusqlite::Result<()> {
    c.execute("UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", params![now(), note_id])?;
    Ok(())
}

/// Restores a deleted note (version + 1). A live note is returned unchanged.
pub fn restore(c: &Connection, note_id: &str) -> rusqlite::Result<Option<Note>> {
    c.execute(
        "UPDATE notes SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
        params![now(), note_id],
    )?;
    reload(c, note_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{parse_create, parse_patch};
    use serde_json::json;

    fn db() -> Connection {
        open(":memory:").unwrap()
    }

    #[test]
    fn seed_tokens_resolve() {
        let c = db();
        assert_eq!(user_by_token(&c, "tok_alice").unwrap().unwrap().id, "alice");
        assert!(user_by_token(&c, "nope").unwrap().is_none());
    }

    #[test]
    fn cas_update_soft_delete_restore() {
        let c = db();
        let n = insert_note(&c, "team-red", "alice", &parse_create(&json!({"title": "a"})).unwrap()).unwrap();
        let p = parse_patch(&json!({"title": "b"})).unwrap();
        assert!(matches!(update_note(&c, &n.id, 1, &p).unwrap(), UpdateOutcome::Updated(x) if x.version == 2));
        assert!(matches!(update_note(&c, &n.id, 1, &p).unwrap(), UpdateOutcome::Stale(x) if x.version == 2));
        soft_delete(&c, &n.id).unwrap();
        assert!(matches!(update_note(&c, &n.id, 2, &p).unwrap(), UpdateOutcome::Gone));
        assert_eq!(list_notes(&c, "team-red", true).unwrap().len(), 1);
        let r = restore(&c, &n.id).unwrap().unwrap();
        assert_eq!((r.version, r.deleted_at), (3, None));
        assert_eq!(restore(&c, &n.id).unwrap().unwrap().version, 3);
    }

    #[test]
    fn membership_scopes_visibility() {
        let c = db();
        let n = insert_note(&c, "team-red", "alice", &parse_create(&json!({"title": "a"})).unwrap()).unwrap();
        assert!(note_for_member(&c, &n.id, "bob").unwrap().is_some());
        assert!(note_for_member(&c, &n.id, "carol").unwrap().is_none());
    }
}
