import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { newNoteFields } from './domain/note.ts';
import { validateCreate, validatePatch } from './domain/validation.ts';
import type { FieldError } from './domain/validation.ts';
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
const ok = (body: unknown): Reply => ({ status: 200, body });

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
    if (e instanceof BodyError) return { reply: problem(e.status, 'payload-too-large', 'Payload Too Large') };
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
    (segs.length === 2 && a === 'notes' && (method === 'GET' || method === 'PATCH' || method === 'DELETE'));
  if (!known) return notFound();

  const user = authenticate(req, store);
  if (!user) return unauthorized();

  if (a === 'me') return ok({ id: user.id, name: user.name, teams: store.teamsOf(user.id) });
  if (a === 'teams' && segs.length === 1) return ok({ items: store.teamsOf(user.id) });

  if (a === 'teams') {
    const teamId = b!;
    if (!store.isMember(teamId, user.id)) return notFound();
    if (method === 'GET') return ok({ items: store.listNotes(teamId) });
    const parsed = await readJson(req);
    if ('reply' in parsed) return parsed.reply;
    const v = validateCreate(parsed.value);
    if (!v.ok) return invalid(v.errors);
    const note = newNoteFields({ id: randomUUID(), teamId, authorId: user.id, ...v.value }, new Date());
    store.insertNote(note);
    return { status: 201, body: note, headers: { location: `/notes/${note.id}` } };
  }

  const noteId = b!;
  if (!store.visibleNote(noteId, user.id)) return notFound();
  if (method === 'GET') return ok(store.visibleNote(noteId, user.id));
  if (method === 'DELETE') {
    store.softDeleteNote(noteId, new Date());
    return { status: 204 };
  }
  const parsed = await readJson(req);
  if ('reply' in parsed) return parsed.reply;
  const v = validatePatch(parsed.value);
  if (!v.ok) return invalid(v.errors);
  // The note may have been deleted while the body was being read.
  const updated = store.patchNote(noteId, v.value, new Date());
  return updated ? ok(updated) : notFound();
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
