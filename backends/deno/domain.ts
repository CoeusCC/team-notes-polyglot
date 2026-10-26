// Pure domain: validation and rules. No I/O.

export const MAX_TITLE = 200;
export const MAX_BODY = 100_000;
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export interface FieldError { field: string; message: string }
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

export const cpLength = (s: string): number => [...s].length;

const READ_ONLY = ["id", "teamId", "authorId", "version", "createdAt", "updatedAt", "deletedAt"];
const WRITABLE = ["title", "body"];

function validate(
  input: unknown,
  requireTitle: boolean,
): Parsed<{ title?: string; body?: string }> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: [{ field: "(body)", message: "must be a JSON object" }] };
  }
  const obj = input as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const k of Object.keys(obj)) {
    if (READ_ONLY.includes(k)) errors.push({ field: k, message: "is read-only" });
    else if (!WRITABLE.includes(k)) errors.push({ field: k, message: "unknown field" });
  }
  const out: { title?: string; body?: string } = {};
  if ("title" in obj) {
    if (typeof obj.title !== "string") errors.push({ field: "title", message: "must be a string" });
    else {
      const t = obj.title.trim();
      const n = cpLength(t);
      if (n < 1 || n > MAX_TITLE) errors.push({ field: "title", message: `must be 1-${MAX_TITLE} characters after trimming` });
      else out.title = t;
    }
  } else if (requireTitle) errors.push({ field: "title", message: "is required" });
  if ("body" in obj) {
    if (typeof obj.body !== "string") errors.push({ field: "body", message: "must be a string" });
    else if (cpLength(obj.body) > MAX_BODY) errors.push({ field: "body", message: `must be at most ${MAX_BODY} characters` });
    else out.body = obj.body;
  }
  if (!requireTitle && errors.length === 0 && Object.keys(obj).length === 0) {
    errors.push({ field: "(body)", message: "must contain at least one field" });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export const parseCreate = (input: unknown): Parsed<{ title: string; body: string }> => {
  const r = validate(input, true);
  if (!r.ok) return r;
  return { ok: true, value: { title: r.value.title!, body: r.value.body ?? "" } };
};

export const parsePatch = (input: unknown) => validate(input, false);

export const etagFor = (version: number): string => `"${version}"`;

export type Precondition =
  | { kind: "missing" }
  | { kind: "version"; matches: (v: number) => boolean };

/** Interpret an If-Match header. Missing or `*` -> "missing" (428). */
export function parseIfMatch(header: string | null): Precondition {
  if (header === null) return { kind: "missing" };
  const h = header.trim();
  if (h === "" || h === "*") return { kind: "missing" };
  const tags = h.split(",").map((s) => s.trim());
  return { kind: "version", matches: (v) => tags.includes(etagFor(v)) };
}

export const isJsonContentType = (ct: string | null): boolean =>
  (ct ?? "").split(";")[0].trim().toLowerCase() === "application/json";

export const isoNow = (): string => new Date().toISOString();
