import { Store } from "./store.ts";
import { createHandler } from "./http.ts";

export function createStore(dbPath = ":memory:"): Store {
  const schema = Deno.readTextFileSync(new URL("../../spec/schema.sql", import.meta.url));
  return new Store(dbPath, schema);
}

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") ?? "3002");
  const store = createStore(Deno.env.get("DB_PATH") ?? ":memory:");
  Deno.serve({ port }, createHandler(store));
}
