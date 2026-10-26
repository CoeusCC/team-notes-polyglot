import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { newNoteFields } from './domain/note.ts';
import { validateCreate, validatePatch, validateTeamCreate } from './domain/validation.ts';
import type { FieldError } from './domain/validation.ts';
import { etag, parseIfMatch } from './domain/precondition.ts';
import type { Note } from './domain/note.ts';
import { fault } from './store.ts';
import type { Store, User } from './store.ts';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PROBLEM = 'application/problem+json';

type Reply = { status: number; body?: unknown; headers?: Record<string, string>; contentType?: string };

const problem = (status: number, slug: string, title: string, extra: Record<string, unknown> = {}): Reply => ({
  status,
  contentType: PROBLEM,
  body: { type: `https://teamnotes.example/problems/${slug}`, title, status, ...extra },
});
const unauthorized = () => problem(401, 'unauthorized', 'Unauthorized', { detail: 'A valid bearer token is required.' });
// One response for every "cannot see it" case: missing, hidden, deleted, wrong team.
const forbidden = () => problem(403, 'forbidden', 'Forbidden', { detail: 'Only the team owner may change membership.' });
const conflict = (detail: string) => problem(409, 'conflict', 'Conflict', { detail });
const notFound = () => problem(404, 'not-found', 'Not Found');
const badRequest = (detail: string) => problem(400, 'bad-request', 'Bad Request', { detail });
const invalid = (errors: FieldError[]) => problem(422, 'validation-failed', 'Validation Failed', { errors });
const unsupportedMediaType = () => problem(415, 'unsupported-media-type', 'Unsupported Media Type', { detail: 'Content-Type must be application/json.' });
const preconditionRequired = () => problem(428, 'precondition-required', 'Precondition Required', { detail: 'A strong If-Match header is required.' });
const preconditionFailed = (version: number): Reply => ({
  ...problem(412, 'precondition-failed', 'Precondition Failed', { detail: 'The note changed since you read it.' }),
  headers: { etag: etag(version) },
});
const ok = (body: unknown): Reply => ({ status: 200, body });
/** A single-note response: the ETag always equals the body's version. */
const noteReply = (status: number, note: Note, headers: Record<string, string> = {}): Reply =>
  ({ status, body: note, headers: { etag: etag(note.version), ...headers } });

/** True when the request's media type is application/json (parameters such as charset are allowed). */
const isJson = (req: IncomingMessage): boolean =>
  (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() === 'application/json';

class BodyError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch {
    throw new BodyError(400, 'request body is not valid UTF-8');
  }
}

/** I-JSON (RFC 7493): no lone surrogate in any string, key or value. */
export function isWellFormed(v: unknown): boolean {
  if (typeof v === 'string') return v.isWellFormed();
  if (Array.isArray(v)) return v.every(isWellFormed);
  if (v !== null && typeof v === 'object') return Object.entries(v).every(([k, x]) => k.isWellFormed() && isWellFormed(x));
  return true;
}

/**
 * Read the body for any operation (ERR-3). A non-empty body must be application/json, else 415 (before 413).
 * Returns the text; '' means no body.
 */
async function takeBody(req: IncomingMessage): Promise<{ text: string } | { reply: Reply }> {
  const close = { connection: 'close' }; // unread bytes may remain, so the socket can't be reused
  let text: string;
  try { text = await readBody(req); } catch (e) {
    if (!(e instanceof BodyError)) throw e;
    if (e.status === 400) return { reply: badRequest('Request body is not valid UTF-8.') };
    if (!isJson(req)) return { reply: { ...unsupportedMediaType(), headers: close } };
    return { reply: { ...problem(e.status, 'payload-too-large', 'Payload Too Large'), headers: close } };
  }
  if (text !== '' && !isJson(req)) return { reply: unsupportedMediaType() };
  return { text };
}

/** Parse a required JSON body: empty is 400 whatever its Content-Type, malformed is 400. */
async function readJson(req: IncomingMessage): Promise<{ value: unknown } | { reply: Reply }> {
  const body = await takeBody(req);
  if ('reply' in body) return body;
  if (body.text === '') return { reply: badRequest('Request body is required.') };
  let value: unknown;
  try { value = JSON.parse(body.text); } catch {
    return { reply: badRequest('Request body is not valid JSON.') };
  }
  if (!isWellFormed(value)) return { reply: badRequest('Request body is not valid JSON.') };
  return { value };
}

function authenticate(req: IncomingMessage, store: Store): User | null {
  // More than one Authorization header is ambiguous: node keeps only one, so count the raw headers (AUTHN-4).
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i]!.toLowerCase() === 'authorization') count++;
  if (count > 1) return null;
  const m = /^Bearer +(\S+)$/i.exec(req.headers.authorization ?? '');
  return m ? store.userByToken(m[1]!) : null;
}

async function route(req: IncomingMessage, store: Store): Promise<Reply> {
  const method = req.method ?? 'GET';
  // Parse the raw target ourselves: new URL('//', base) would treat the path as a host (AUTHN-3).
  const rawTarget = req.url ?? '/';
  const qi = rawTarget.search(/[?#]/);
  const pathname = qi < 0 ? rawTarget : rawTarget.slice(0, qi);
  const query = new URLSearchParams(qi >= 0 && rawTarget[qi] === '?' ? rawTarget.slice(qi + 1).split('#')[0] : '');
  // A trailing slash, an empty segment or a malformed percent-escape is simply an unknown route.
  let segs: string[] | null = null;
  try {
    if (pathname.startsWith('/') && !pathname.includes('//') && (!pathname.endsWith('/') || pathname === '/')) {
      segs = pathname.split('/').filter(Boolean).map(decodeURIComponent);
      // Never resolve dot segments: any "." or ".." is an unknown route (AUTHN-4).
      if (segs.some((s) => s === '.' || s === '..')) segs = null;
    }
  } catch { /* unknown route */ }
  const [a, b, c] = segs ?? [];

  if (method === 'GET' && segs?.length === 1 && a === 'health') return ok({ status: 'ok' });

  // Auth before routing: no token, no hints about which routes exist (AUTHN-2).
  const user = authenticate(req, store);
  if (!user) return unauthorized();

  const known = segs !== null && (
    (segs.length === 1 && (a === 'me' || a === 'teams') && method === 'GET') ||
    (segs.length === 1 && a === 'teams' && method === 'POST') ||
    (segs.length === 2 && a === 'teams' && method === 'GET') ||
    (segs.length === 3 && a === 'teams' && c === 'members' && method === 'GET') ||
    (segs.length === 4 && a === 'teams' && b !== undefined && segs[2] === 'members' && (method === 'PUT' || method === 'DELETE')) ||
    (segs.length === 3 && a === 'teams' && c === 'notes' && (method === 'GET' || method === 'POST')) ||
    (segs.length === 2 && a === 'notes' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) ||
    (segs.length === 3 && a === 'notes' && c === 'restore' && method === 'POST'));
  if (!known) return notFound();

  if (a === 'me') return ok({ id: user.id, name: user.name, teams: store.teamsOf(user.id) });
  if (a === 'teams' && segs!.length === 1) {
    return method === 'POST' ? createTeam(req, store, user) : ok({ items: store.teamsOf(user.id) });
  }
  if (a === 'teams' && c !== 'notes') return teamRoute(req, store, user, method, segs!);

  if (a === 'teams') {
    const teamId = b!;
    if (!store.isMember(teamId, user.id)) return notFound();
    if (method === 'GET') {
      const raw = query.get('archived');
      if (raw !== null && raw !== 'true' && raw !== 'false') return invalid([{ field: 'archived', message: 'must be true or false' }]);
      return ok({ items: store.listNotes(teamId, raw === 'true') });
    }
    const parsed = await readJson(req);
    if ('reply' in parsed) return parsed.reply;
    const v = validateCreate(parsed.value);
    if (!v.ok) return invalid(v.errors);
    // FAULT no-trim: store the title as sent, untrimmed (validation already proved it is a string).
    const title = fault('no-trim') ? String((parsed.value as { title: unknown }).title) : v.value.title;
    const note = newNoteFields({ id: randomUUID(), teamId, authorId: user.id, ...v.value, title }, new Date());
    store.insertNote(note);
    return noteReply(201, note, { location: `/notes/${note.id}` });
  }

  const noteId = b!;
  const note = store.visibleNote(noteId, user.id);
  if (!note) {
    // FAULT leak-403: reveal that a note in another team exists.
    if (fault('leak-403') && method === 'GET' && store.noteExists(noteId)) return problem(403, 'forbidden', 'Forbidden');
    return notFound();
  }
  if (c === 'restore' || method === 'DELETE') {
    // Any non-empty non-JSON body is 415 (ERR-3); a JSON body is ignored. DELETE ignores If-Match (DEL-5).
    const body = await takeBody(req);
    if ('reply' in body) return body.reply;
    if (c === 'restore') return noteReply(200, store.restoreNote(noteId, new Date())!);
    store.softDeleteNote(noteId, new Date());
    return { status: 204 };
  }
  // Deleted notes are hidden from GET and PATCH.
  if (note.deletedAt !== undefined) return notFound();
  if (method === 'GET') return noteReply(200, note);
  return patch(req, store, note, user);
}

async function createTeam(req: IncomingMessage, store: Store, user: User): Promise<Reply> {
  const parsed = await readJson(req);
  if ('reply' in parsed) return parsed.reply;
  const v = validateTeamCreate(parsed.value);
  if (!v.ok) return invalid(v.errors);
  if (!store.createTeam(v.value.id, v.value.name, user.id)) return conflict('A team with this id already exists.');
  return { status: 201, body: { ...v.value, role: 'owner' }, headers: { location: `/teams/${v.value.id}` } };
}

/** Team reads and owner-only membership changes. 404 for non-members, then 403 for non-owners (ADR-0006). */
async function teamRoute(req: IncomingMessage, store: Store, user: User, method: string, segs: string[]): Promise<Reply> {
  const teamId = segs[1]!;
  const team = store.teamFor(teamId, user.id);
  if (!team) return notFound();
  if (method === 'GET') return ok(segs.length === 2 ? team : { items: store.members(teamId) });
  if (team.role !== 'owner') return forbidden();
  const body = await takeBody(req); // a JSON body is ignored; any other non-empty body is 415
  if ('reply' in body) return body.reply;
  const userId = segs[3]!;
  if (method === 'PUT') {
    if (!store.userExists(userId)) return invalid([{ field: 'userId', message: 'unknown user' }]);
    return ok(store.addMember(teamId, userId));
  }
  return store.removeMember(teamId, userId) ? { status: 204 } : conflict('The last owner cannot be removed.');
}

/** PATCH, in precedence order: 413, 400, 422, 428, 412 (415 for a non-JSON body). Visibility (401, 404) is already decided. */
async function patch(req: IncomingMessage, store: Store, note: Note, user: User): Promise<Reply> {
  const parsed = await readJson(req);
  if ('reply' in parsed) return parsed.reply;
  const v = validatePatch(parsed.value);
  if (!v.ok) return invalid(v.errors);
  let expected = parseIfMatch(req.headers['if-match']);
  // FAULT ignore-if-match: accept whatever If-Match says (or omits), allowing lost updates.
  if (fault('ignore-if-match')) expected = [store.visibleNote(note.id, user.id)?.version ?? 0];
  if (expected === null) return preconditionRequired();
  const out = store.patchNote(note.id, v.value, expected, new Date());
  if (out.kind === 'updated') return noteReply(200, out.note);
  return out.kind === 'stale' ? preconditionFailed(out.version) : notFound();
}

function send(res: ServerResponse, reply: Reply): void {
  const payload = reply.body === undefined ? '' : JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    ...(payload ? { 'content-type': reply.contentType ?? 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
    ...reply.headers,
  });
  res.end(payload);
}

export function createServer(store: Store): Server {
  return createHttpServer({ requireHostHeader: false }, (req, res) => {
    route(req, store).then(
      (reply) => send(res, reply),
      () => send(res, problem(500, 'internal', 'Internal Server Error')),
    );
  });
}
