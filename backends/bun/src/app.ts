// Team Notes HTTP application: a pure (Request) => Response function over a bun:sqlite Database.
import type { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { ifMatchVerdict, treeHasLoneSurrogate } from './text.ts';
import { validateNoteCreate, validateNotePatch, validateTeamCreate, type FieldError } from './validate.ts';

const MAX_BODY = 2 * 1024 * 1024;
const PROBLEM = 'application/problem+json';

class HttpError extends Error {
  constructor(public status: number, public title: string, public errors?: FieldError[], public headers: Record<string, string> = {}) {
    super(title);
  }
}
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const problemRes = (e: HttpError) =>
  new Response(
    JSON.stringify({ type: `https://teamnotes.example/problems/${slug(e.title)}`, title: e.title, status: e.status, ...(e.errors ? { errors: e.errors } : {}) }),
    { status: e.status, headers: { 'content-type': PROBLEM, ...e.headers } },
  );
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const NOT_FOUND = () => new HttpError(404, 'Not Found');
const UNPROCESSABLE = (errors: FieldError[]) => new HttpError(422, 'Unprocessable Entity', errors);

type NoteRow = {
  id: string; team_id: string; author_id: string; title: string; body: string;
  version: number; created_at: string; updated_at: string; deleted_at: string | null;
};
const noteJson = (r: NoteRow) => ({
  id: r.id, teamId: r.team_id, authorId: r.author_id, title: r.title, body: r.body,
  version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
  ...(r.deleted_at !== null ? { deletedAt: r.deleted_at } : {}),
});
const etag = (v: number) => `"${v}"`;
const noteRes = (status: number, r: NoteRow, extra: Record<string, string> = {}) =>
  json(status, noteJson(r), { etag: etag(r.version), ...extra });

type User = { id: string; name: string };

export function createApp(db: Database) {
  const q = {
    user: db.query<User, [string]>('SELECT id, name FROM users WHERE token_hash = ?'),
    userById: db.query<User, [string]>('SELECT id, name FROM users WHERE id = ?'),
    role: db.query<{ role: 'owner' | 'member' }, [string, string]>('SELECT role FROM memberships WHERE team_id = ? AND user_id = ?'),
    team: db.query<{ id: string; name: string }, [string]>('SELECT id, name FROM teams WHERE id = ?'),
    myTeams: db.query<{ id: string; name: string; role: string }, [string]>(
      'SELECT t.id, t.name, m.role FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.id'),
    roster: db.query<{ id: string; name: string; role: string }, [string]>(
      `SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.id`),
    note: db.query<NoteRow, [string]>('SELECT id, team_id, author_id, title, body, version, created_at, updated_at, deleted_at FROM notes WHERE id = ?'),
    list: db.query<NoteRow, [string, number]>(
      `SELECT id, team_id, author_id, title, body, version, created_at, updated_at, deleted_at FROM notes
       WHERE team_id = ? AND (deleted_at IS NOT NULL) = ? ORDER BY seq DESC`),
    insertNote: db.query<unknown, [string, string, string, string, string, string, string]>(
      'INSERT INTO notes (id, team_id, author_id, title, body, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'),
    insertTeam: db.query<unknown, [string, string, string]>('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)'),
    insertMember: db.query<unknown, [string, string, string]>('INSERT OR IGNORE INTO memberships (team_id, user_id, role) VALUES (?, ?, ?)'),
    deleteMember: db.query<unknown, [string, string]>('DELETE FROM memberships WHERE team_id = ? AND user_id = ?'),
    softDelete: db.query<unknown, [string, string]>('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'),
    restore: db.query<unknown, [string, string]>(
      'UPDATE notes SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL'),
  };

  const roleOf = (teamId: string, userId: string) => q.role.get(teamId, userId)?.role ?? null;
  const dec = (s: string): string | null => { try { return decodeURIComponent(s); } catch { return null; } };

  /** Read the body once. Enforces, in order: 415 (non-empty, not JSON), 413 (> 2 MiB). */
  async function readBody(req: Request): Promise<Uint8Array> {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > 0) {
      const ct = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (ct !== 'application/json') throw new HttpError(415, 'Unsupported Media Type');
    }
    if (bytes.length > MAX_BODY) throw new HttpError(413, 'Payload Too Large', undefined, { connection: 'close' });
    return bytes;
  }

  /** Strict UTF-8 + JSON + I-JSON scalar check; any failure is 400. */
  function parseJson(bytes: Uint8Array): unknown {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new HttpError(400, 'Bad Request'); }
    let v: unknown;
    try { v = JSON.parse(text); } catch { throw new HttpError(400, 'Bad Request'); }
    if (treeHasLoneSurrogate(v)) throw new HttpError(400, 'Bad Request');
    return v;
  }

  async function jsonBody(req: Request): Promise<unknown> {
    const bytes = await readBody(req);
    if (bytes.length === 0) throw new HttpError(400, 'Bad Request');
    return parseJson(bytes);
  }

  /** Note visible to the caller (member of its team), else 404. */
  function visibleNote(id: string, user: User, allowDeleted: boolean): NoteRow {
    const n = q.note.get(id);
    if (!n || !roleOf(n.team_id, user.id) || (n.deleted_at !== null && !allowDeleted)) throw NOT_FOUND();
    return n;
  }

  async function route(req: Request, method: string, segs: string[], search: string, user: User): Promise<Response> {
    const [a, b, c, d] = segs;
    const n = segs.length;

    if (a === 'me' && n === 1 && method === 'GET') {
      await readBody(req);
      return json(200, { id: user.id, name: user.name, teams: q.myTeams.all(user.id) });
    }

    if (a === 'teams') {
      if (n === 1 && method === 'GET') { await readBody(req); return json(200, { items: q.myTeams.all(user.id) }); }
      if (n === 1 && method === 'POST') {
        const body = await jsonBody(req);
        const v = validateTeamCreate(body);
        if (!v.ok) throw UNPROCESSABLE(v.errors);
        if (q.team.get(v.value.id)) throw new HttpError(409, 'Conflict');
        db.transaction(() => {
          q.insertTeam.run(v.value.id, v.value.name, user.id);
          q.insertMember.run(v.value.id, user.id, 'owner');
        })();
        return json(201, { id: v.value.id, name: v.value.name, role: 'owner' }, { location: `/teams/${v.value.id}` });
      }
      const teamId = b === undefined ? null : dec(b);
      if (teamId === null || teamId === '' || n < 2) throw NOT_FOUND();
      const team = q.team.get(teamId);
      const role = team ? roleOf(teamId, user.id) : null;

      if (n === 2 && method === 'GET') {
        if (!team || !role) throw NOT_FOUND();
        await readBody(req);
        return json(200, { id: team.id, name: team.name, role });
      }
      if (n === 3 && c === 'members' && method === 'GET') {
        if (!team || !role) throw NOT_FOUND();
        await readBody(req);
        return json(200, { items: q.roster.all(teamId) });
      }
      if (n === 4 && c === 'members' && (method === 'PUT' || method === 'DELETE')) {
        if (!team || !role) throw NOT_FOUND();
        if (role !== 'owner') throw new HttpError(403, 'Forbidden');
        await readBody(req); // 415 / 413 only; a JSON body is ignored
        const userId = dec(d!);
        if (method === 'PUT') {
          const target = userId === null ? null : q.userById.get(userId);
          if (!target) throw UNPROCESSABLE([{ field: 'userId', message: 'unknown user' }]);
          q.insertMember.run(teamId, target.id, 'member');
          return json(200, { id: target.id, name: target.name, role: roleOf(teamId, target.id) });
        }
        if (userId !== null && roleOf(teamId, userId) === 'owner') {
          const owners = q.roster.all(teamId).filter((m) => m.role === 'owner').length;
          if (owners <= 1) throw new HttpError(409, 'Conflict');
        }
        if (userId !== null) q.deleteMember.run(teamId, userId);
        return new Response(null, { status: 204 });
      }
      if (n === 3 && c === 'notes' && (method === 'GET' || method === 'POST')) {
        if (!team || !role) throw NOT_FOUND();
        if (method === 'GET') {
          await readBody(req);
          const vals = new URLSearchParams(search).getAll('archived');
          if (vals.some((x) => x !== 'true' && x !== 'false'))
            throw UNPROCESSABLE([{ field: 'archived', message: "must be 'true' or 'false'" }]);
          const archived = vals.length > 0 && vals[vals.length - 1] === 'true';
          return json(200, { items: q.list.all(teamId, archived ? 1 : 0).map(noteJson) });
        }
        const v = validateNoteCreate(await jsonBody(req));
        if (!v.ok) throw UNPROCESSABLE(v.errors);
        const id = randomUUID();
        const now = new Date().toISOString();
        q.insertNote.run(id, teamId, user.id, v.value.title, v.value.body, now, now);
        return noteRes(201, q.note.get(id)!, { location: `/notes/${id}` });
      }
      throw NOT_FOUND();
    }

    if (a === 'notes' && b !== undefined) {
      const id = dec(b);
      if (id === null || id === '') throw NOT_FOUND();
      if (n === 2 && method === 'GET') {
        const note = visibleNote(id, user, false);
        await readBody(req);
        return noteRes(200, note);
      }
      if (n === 2 && method === 'PATCH') {
        const note = visibleNote(id, user, false);
        const v = validateNotePatch(await jsonBody(req));
        if (!v.ok) throw UNPROCESSABLE(v.errors);
        const verdict = ifMatchVerdict(req.headers.get('if-match'), etag(note.version));
        if (verdict === 'missing' || verdict === 'wildcard') throw new HttpError(428, 'Precondition Required');
        const stale = (cur: NoteRow) => new HttpError(412, 'Precondition Failed', undefined, { etag: etag(cur.version) });
        if (verdict === 'nomatch') throw stale(note);
        // Single conditional UPDATE: the check and the increment are one atomic statement.
        const res = db.query(
          `UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body), version = version + 1, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        ).run(v.value.title ?? null, v.value.body ?? null, new Date().toISOString(), id, note.version);
        if (res.changes === 0) {
          const cur = q.note.get(id);
          if (!cur || cur.deleted_at !== null) throw NOT_FOUND();
          throw stale(cur);
        }
        return noteRes(200, q.note.get(id)!);
      }
      if (n === 2 && method === 'DELETE') {
        visibleNote(id, user, true);
        await readBody(req);
        q.softDelete.run(new Date().toISOString(), id);
        return new Response(null, { status: 204 });
      }
      if (n === 3 && c === 'restore' && method === 'POST') {
        visibleNote(id, user, true);
        await readBody(req);
        q.restore.run(new Date().toISOString(), id);
        return noteRes(200, q.note.get(id)!);
      }
    }
    throw NOT_FOUND();
  }

  return async function handle(req: Request): Promise<Response> {
    try {
      // Raw path: never normalised or decoded before routing.
      const rest = req.url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/, '');
      const qi = rest.indexOf('?');
      const path = (qi < 0 ? rest : rest.slice(0, qi)).split('#')[0]!;
      const search = qi < 0 ? '' : rest.slice(qi + 1).split('#')[0]!;
      const method = req.method.toUpperCase();

      if (path === '/health' && method === 'GET') return json(200, { status: 'ok' });

      const m = /^bearer +(.+)$/i.exec(req.headers.get('authorization') ?? '');
      const user = m ? q.user.get(createHash('sha256').update(m[1]!.trim()).digest('hex')) : null;
      if (!user) throw new HttpError(401, 'Unauthorized', undefined, { 'www-authenticate': 'Bearer' });

      if (!path.startsWith('/')) throw NOT_FOUND();
      return await route(req, method, path.slice(1).split('/'), search, user);
    } catch (e) {
      if (e instanceof HttpError) return problemRes(e);
      console.error(e);
      return problemRes(new HttpError(500, 'Internal Server Error'));
    }
  };
}
