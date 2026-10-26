import {
  etagFor, isJsonContentType, isoNow, MAX_REQUEST_BYTES, parseArchived, parseCreate, parseIfMatch, parsePatch, parseTeam,
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
type Raw = { ok: true; bytes: Uint8Array } | { ok: false; res: Response };

/** Reads the raw body: non-empty non-JSON -> 415, then oversize -> 413. */
async function readRaw(req: Request): Promise<Raw> {
  const tooLarge = () => ({
    ok: false as const,
    res: problem(413, "Payload Too Large", {}, { connection: "close" }),
  });
  const nonJson = !isJsonContentType(req.headers.get("content-type"));
  const len = req.headers.get("content-length");
  if (len !== null && Number(len) > MAX_REQUEST_BYTES) {
    return nonJson ? { ok: false, res: problem(415, "Unsupported Media Type") } : tooLarge();
  }
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
  if (total > 0 && nonJson) return { ok: false, res: problem(415, "Unsupported Media Type") };
  return { ok: true, bytes: buf.subarray(0, total) };
}

/** True if every string (keys included) in a parsed JSON value is free of lone surrogates. */
function wellFormed(v: unknown): boolean {
  if (typeof v === "string") return v.isWellFormed();
  if (Array.isArray(v)) return v.every(wellFormed);
  if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => k.isWellFormed() && wellFormed(x));
  return true;
}

/** For operations that require a JSON body: empty -> 400, malformed -> 400. */
async function readJson(req: Request): Promise<Body> {
  const raw = await readRaw(req);
  if (!raw.ok) return raw;
  if (raw.bytes.length === 0) return { ok: false, res: problem(400, "Request body required") };
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw.bytes));
    if (!wellFormed(value)) throw new Error("lone surrogate");
    return { ok: true, value };
  } catch {
    return { ok: false, res: problem(400, "Malformed JSON") };
  }
}

/** For operations that ignore the body (restore, DELETE): only media/size rules apply. */
async function checkIgnoredBody(req: Request): Promise<Response | null> {
  const raw = await readRaw(req);
  return raw.ok ? null : raw.res;
}

const invalid = (errors: FieldError[]) => problem(422, "Validation Failed", { errors });

const safeDecode = (s: string): string | null => {
  try { return decodeURIComponent(s); } catch { return null; }
};

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
  // URL.pathname resolves dot segments; take the path from the raw request URL instead (AUTHN-4).
  const rest = req.url.slice(url.origin.length);
  const path = rest.split(/[?#]/, 1)[0];
  const hasDot = path.split("/").some((s) => { const d = safeDecode(s); return d === "." || d === ".."; });
  const method = req.method;
  if (path === "/health" && method === "GET") return json(200, { status: "ok" });

  const user = authenticate(req, store);
  if (!user) return problem(401, "Unauthorized", {}, { "www-authenticate": "Bearer" });
  if (hasDot) return notFound();

  if (path === "/me" && method === "GET") {
    return json(200, { id: user.id, name: user.name, teams: store.teamsOf(user.id) });
  }
  if (path === "/teams" && method === "GET") return json(200, { items: store.teamsOf(user.id) });
  if (path === "/teams" && method === "POST") {
    const body = await readJson(req);
    if (!body.ok) return body.res;
    const parsed = parseTeam(body.value);
    if (!parsed.ok) return invalid(parsed.errors);
    const { id, name } = parsed.value;
    if (!store.createTeam(id, name, user.id)) return problem(409, "Team id already taken");
    return json(201, { id, name, role: "owner" }, { location: `/teams/${id}` });
  }

  let m = /^\/teams\/([^/]+)$/.exec(path);
  if (m && method === "GET") {
    const t = store.getTeam(safeDecode(m[1]) ?? "", user.id);
    return t ? json(200, t) : notFound();
  }

  m = /^\/teams\/([^/]+)\/members$/.exec(path);
  if (m && method === "GET") {
    const teamId = safeDecode(m[1]) ?? "";
    return store.isMember(teamId, user.id) ? json(200, { items: store.members(teamId) }) : notFound();
  }

  m = /^\/teams\/([^/]+)\/members\/([^/]+)$/.exec(path);
  if (m && (method === "PUT" || method === "DELETE")) {
    const teamId = safeDecode(m[1]);
    const userId = safeDecode(m[2]);
    const mine = teamId === null ? null : store.getTeam(teamId, user.id);
    if (!mine || teamId === null) return notFound();
    if (mine.role !== "owner") return problem(403, "Forbidden");
    const bad = await checkIgnoredBody(req);
    if (bad) return bad;
    if (method === "PUT") {
      const target = userId === null ? null : store.userById(userId);
      if (!target) return invalid([{ field: "userId", message: "unknown user" }]);
      return json(200, { id: target.id, name: target.name, role: store.addMember(teamId, target.id) });
    }
    if (userId !== null && !store.removeMember(teamId, userId)) return problem(409, "Cannot remove the last owner");
    return new Response(null, { status: 204 });
  }


  m = /^\/teams\/([^/]+)\/notes$/.exec(path);
  if (m && (method === "GET" || method === "POST")) {
    const teamId = safeDecode(m[1]);
    if (teamId === null) return notFound();
    if (!store.isMember(teamId, user.id)) return notFound();
    if (method === "GET") {
      const arch = parseArchived(url.searchParams.get("archived"));
      if (!arch.ok) return invalid(arch.errors);
      return json(200, { items: store.listNotes(teamId, arch.value) });
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
    const id = safeDecode(m[1]);
    if (id === null) return notFound();
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
        const bad = await checkIgnoredBody(req);
        if (bad) return bad;
        store.softDelete(n.id, isoNow());
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") return await patch(req, store, visible());
    } else if (method === "POST") {
      const n = visible();
      if (!n) return notFound();
      const bad = await checkIgnoredBody(req);
      if (bad) return bad;
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
