import {
  etagFor, isJsonContentType, isoNow, MAX_REQUEST_BYTES, parseCreate, parseIfMatch, parsePatch,
  type FieldError,
} from "./domain.ts";
import type { Note, Store, User } from "./store.ts";

const PROBLEM = "application/problem+json";

function problem(status: number, title: string, extra: Record<string, unknown> = {}, headers: HeadersInit = {}): Response {
  return new Response(
    JSON.stringify({ type: `https://teamnotes.example/problems/${status}`, title, status, ...extra }),
    { status, headers: { "content-type": PROBLEM, ...headers } },
  );
}
// One fixed body: hidden, missing, malformed and unknown routes are byte-identical.
const notFound = () => problem(404, "Not Found");
const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const noteResponse = (status: number, n: Note, headers: HeadersInit = {}) =>
  json(status, n, { etag: etagFor(n.version), ...headers });

type Body = { ok: true; value: unknown } | { ok: false; res: Response };

/** Reads the body applying 415 -> 413 -> 400 in order. */
async function readJson(req: Request): Promise<Body> {
  const len = req.headers.get("content-length");
  const hasBody = req.body !== null && len !== "0";
  if (hasBody && !isJsonContentType(req.headers.get("content-type"))) {
    return { ok: false, res: problem(415, "Unsupported Media Type") };
  }
  const tooLarge = () => ({
    ok: false as const,
    res: problem(413, "Payload Too Large", {}, { connection: "close" }),
  });
  if (len !== null && Number(len) > MAX_REQUEST_BYTES) return tooLarge();
  const buf = new Uint8Array(MAX_REQUEST_BYTES);
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > MAX_REQUEST_BYTES) { reader.cancel().catch(() => {}); return tooLarge(); }
      buf.set(value, total);
      total += value.byteLength;
    }
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buf.subarray(0, total))) };
  } catch {
    return { ok: false, res: problem(400, "Malformed JSON") };
  }
}

const invalid = (errors: FieldError[]) => problem(422, "Validation Failed", { errors });

function authenticate(req: Request, store: Store): User | null {
  const m = /^Bearer +(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? store.userByToken(m[1]) : null;
}

export function createHandler(store: Store): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await route(req, store);
    } catch (e) {
      console.error(e);
      return problem(500, "Internal Server Error");
    }
  };
}

async function route(req: Request, store: Store): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  if (path === "/health" && method === "GET") return json(200, { status: "ok" });

  const user = authenticate(req, store);
  if (!user) return problem(401, "Unauthorized", {}, { "www-authenticate": "Bearer" });

  if (path === "/me" && method === "GET") {
    return json(200, { id: user.id, name: user.name, teams: store.teamsOf(user.id) });
  }
  if (path === "/teams" && method === "GET") return json(200, { items: store.teamsOf(user.id) });

  let m = /^\/teams\/([^/]+)\/notes$/.exec(path);
  if (m && (method === "GET" || method === "POST")) {
    const teamId = decodeURIComponent(m[1]);
    if (!store.isMember(teamId, user.id)) return notFound();
    if (method === "GET") {
      return json(200, { items: store.listNotes(teamId, url.searchParams.get("archived") === "true") });
    }
    const body = await readJson(req);
    if (!body.ok) return body.res;
    const parsed = parseCreate(body.value);
    if (!parsed.ok) return invalid(parsed.errors);
    const note = store.createNote(teamId, user.id, parsed.value.title, parsed.value.body, isoNow());
    return noteResponse(201, note, { location: `/notes/${note.id}` });
  }

  m = /^\/notes\/([^/]+)(\/restore)?$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const visible = (): Note | null => {
      const n = store.findNote(id);
      return n && store.isMember(n.teamId, user.id) ? n : null;
    };
    if (!m[2]) {
      if (method === "GET") {
        const n = visible();
        return !n || n.deletedAt ? notFound() : noteResponse(200, n);
      }
      if (method === "DELETE") {
        const n = visible();
        if (!n) return notFound();
        store.softDelete(n.id, isoNow());
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") return await patch(req, store, visible());
    } else if (method === "POST") {
      const n = visible();
      if (!n) return notFound();
      return noteResponse(200, n.deletedAt ? store.restore(n.id, isoNow())! : n);
    }
  }
  return notFound();
}

async function patch(req: Request, store: Store, note: Note | null): Promise<Response> {
  if (!note || note.deletedAt) return notFound();
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = parsePatch(body.value);
  if (!parsed.ok) return invalid(parsed.errors);
  const pre = parseIfMatch(req.headers.get("if-match"));
  if (pre.kind === "missing") return problem(428, "Precondition Required");
  // Re-read after the async body read so the check sees current state.
  const current = store.findNote(note.id);
  if (!current || current.deletedAt) return notFound();
  const stale = () => problem(412, "Precondition Failed", {}, { etag: etagFor(current.version) });
  if (!pre.matches(current.version)) return stale();
  const updated = store.updateNote(current.id, current.version, parsed.value, isoNow());
  return updated ? noteResponse(200, updated) : stale();
}
