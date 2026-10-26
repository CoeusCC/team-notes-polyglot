import { assert, assertEquals } from "jsr:@std/assert@1";
import { cpLength, parseCreate, parseIfMatch, parsePatch } from "./domain.ts";
import { createStore } from "./main.ts";
import { createHandler } from "./http.ts";

// ---- domain (pure) ----
Deno.test("title is trimmed and counted in code points", () => {
  const ok = parseCreate({ title: "  hi  " });
  assert(ok.ok && ok.value.title === "hi" && ok.value.body === "");
  assert(parseCreate({ title: "😀".repeat(200) }).ok);
  assert(!parseCreate({ title: "😀".repeat(201) }).ok);
  assertEquals(cpLength("😀"), 1);
});

Deno.test("create rejects bad shapes with field names", () => {
  for (const bad of [null, [1], "x", {}, { title: 4 }, { title: "t", foo: 1 }, { title: "t", version: 2 }]) {
    const r = parseCreate(bad);
    assert(!r.ok && r.errors.length > 0, JSON.stringify(bad));
  }
  const r = parsePatch({ authorId: "carol" });
  assert(!r.ok && r.errors[0].field === "authorId");
  assert(!parsePatch({}).ok);
});

Deno.test("If-Match: missing and * are 'missing'; quoted version matches", () => {
  assertEquals(parseIfMatch(null).kind, "missing");
  assertEquals(parseIfMatch("*").kind, "missing");
  const p = parseIfMatch('"3"');
  assert(p.kind === "version" && p.matches(3) && !p.matches(2));
});

// ---- HTTP through the handler, no socket ----
const call = (h: (r: Request) => Promise<Response>, method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}) =>
  h(new Request("http://x" + path, {
    method,
    headers: { ...(who ? { authorization: `Bearer tok_${who}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

Deno.test("note lifecycle: ETag, 428, 412, soft delete, restore, trash", async () => {
  const h = createHandler(createStore());
  const created = await call(h, "POST", "/teams/team-red/notes", "alice", { title: "a", body: "b" });
  assertEquals(created.status, 201);
  assertEquals(created.headers.get("etag"), '"1"');
  const n = await created.json();
  assertEquals((await call(h, "PATCH", `/notes/${n.id}`, "bob", { title: "c" })).status, 428);
  assertEquals((await call(h, "PATCH", `/notes/${n.id}`, "bob", { title: "c" }, { "if-match": "*" })).status, 428);
  const p = await call(h, "PATCH", `/notes/${n.id}`, "bob", { title: "c" }, { "if-match": '"1"' });
  assertEquals(p.headers.get("etag"), '"2"');
  assertEquals((await call(h, "PATCH", `/notes/${n.id}`, "alice", { title: "d" }, { "if-match": '"1"' })).status, 412);
  assertEquals((await call(h, "DELETE", `/notes/${n.id}`, "alice")).status, 204);
  assertEquals((await call(h, "DELETE", `/notes/${n.id}`, "alice")).status, 204);
  assertEquals((await call(h, "GET", `/notes/${n.id}`, "alice")).status, 404);
  const trash = await (await call(h, "GET", "/teams/team-red/notes?archived=true", "bob")).json();
  assertEquals(trash.items.length, 1);
  assert(trash.items[0].deletedAt);
  assertEquals((await call(h, "POST", `/notes/${n.id}/restore`, "carol")).status, 404);
  const r = await (await call(h, "POST", `/notes/${n.id}/restore`, "bob")).json();
  assertEquals([r.version, r.title, r.deletedAt], [3, "c", undefined]);
});

Deno.test("error precedence and identical 404s", async () => {
  const h = createHandler(createStore());
  const n = await (await call(h, "POST", "/teams/team-red/notes", "alice", { title: "s" })).json();
  const raw = (who: string | null, ct: string, body: string) =>
    h(new Request(`http://x/notes/${n.id}`, { method: "PATCH", headers: { ...(who ? { authorization: `Bearer tok_${who}` } : {}), "content-type": ct }, body }));
  assertEquals((await raw(null, "text/plain", "{")).status, 401);
  assertEquals((await raw("carol", "text/plain", "{")).status, 404);
  assertEquals((await raw("bob", "text/plain", "{")).status, 415);
  assertEquals((await raw("bob", "application/json", "{")).status, 400);
  const bodies = await Promise.all([n.id, crypto.randomUUID(), "not-a-uuid"].map(async (id) =>
    await (await call(h, "GET", `/notes/${id}`, "carol")).text()));
  assert(bodies.every((b) => b === bodies[0]));
});
