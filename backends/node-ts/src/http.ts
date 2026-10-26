import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { newNoteFields } from './domain/note.ts';
import { validateCreate, validatePatch } from './domain/validation.ts';
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
  return Buffer.concat(chunks).toString('utf8');
}

/** Parse the JSON body. Returns a 400 reply on malformed JSON. */
async function readJson(req: IncomingMessage): Promise<{ value: unknown } | { reply: Reply }> {
  let text: string;
  try { text = await readBody(req); } catch (e) {
    // The rest of the body is unread, so the socket can't be reused: tell the client to close it.
    if (e instanceof BodyError) return { reply: { ...problem(e.status, 'payload-too-large', 'Payload Too Large'), headers: { connection: 'close' } } };
    throw e;
  }
  try { return { value: JSON.parse(text) }; } catch {
    return { reply: badRequest('Request body is not valid JSON.') };
  }
}

function authenticate(req: IncomingMessage, store: Store): User | null {
  const m = /^Bearer +(\S+)$/i.exec(req.headers.authorization ?? '');
  return m ? store.userByToken(m[1]!) : null;
}

async function route(req: IncomingMessage, store: Store): Promise<Reply> {
  const method = req.method ?? 'GET';
  const segs = new URL(req.url ?? '/', 'http://x').pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = segs;

  if (method === 'GET' && segs.length === 1 && a === 'health') return ok({ status: 'ok' });

  const known =
    (segs.length === 1 && (a === 'me' || a === 'teams') && method === 'GET') ||
    (segs.length === 3 && a === 'teams' && c === 'notes' && (method === 'GET' || method === 'POST')) ||
    (segs.length === 2 && a === 'notes' && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) ||
    (segs.length === 3 && a === 'notes' && c === 'restore' && method === 'POST');
  if (!known) return notFound();

  const user = authenticate(req, store);
  if (!user) return unauthorized();

  if (a === 'me') return ok({ id: user.id, name: user.name, teams: store.teamsOf(user.id) });
  if (a === 'teams' && segs.length === 1) return ok({ items: store.teamsOf(user.id) });

  if (a === 'teams') {
    const teamId = b!;
    if (!store.isMember(teamId, user.id)) return notFound();
    if (method === 'GET') {
      const archived = new URL(req.url ?? '/', 'http://x').searchParams.get('archived') === 'true';
      return ok({ items: store.listNotes(teamId, archived) });
    }
    if (!isJson(req)) return unsupportedMediaType();
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
  if (c === 'restore') return noteReply(200, store.restoreNote(noteId, new Date())!);
  if (method === 'DELETE') {
    store.softDeleteNote(noteId, new Date());
    return { status: 204 };
  }
  // Deleted notes are hidden from GET and PATCH.
  if (note.deletedAt !== undefined) return notFound();
  if (method === 'GET') return noteReply(200, note);
  return patch(req, store, note, user);
}

/** PATCH, in precedence order: 415, 413, 400, 422, 428, 412. Visibility (401, 404) is already decided. */
async function patch(req: IncomingMessage, store: Store, note: Note, user: User): Promise<Reply> {
  if (!isJson(req)) return unsupportedMediaType();
  const parsed = await readJson(req);
  if ('reply' in parsed) return parsed.reply;
  const v = validatePatch(parsed.value);
  if (!v.ok) return invalid(v.errors);
  let expected = parseIfMatch(req.headers['if-match']);
  // FAULT ignore-if-match: accept whatever If-Match says (or omits), allowing lost updates.
  if (fault('ignore-if-match')) expected = store.visibleNote(note.id, user.id)?.version ?? expected;
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
  return createHttpServer((req, res) => {
    route(req, store).then(
      (reply) => send(res, reply),
      () => send(res, problem(500, 'internal', 'Internal Server Error')),
    );
  });
}
