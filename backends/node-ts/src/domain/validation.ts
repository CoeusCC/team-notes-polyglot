// Pure input validation. No I/O. Parses unknown JSON once into trusted values.

export type FieldError = { field: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

export type NoteCreate = { title: string; body: string };
export type NotePatch = { title?: string; body?: string };

export const TITLE_MAX = 200;
export const BODY_MAX = 100000;

/** Length in Unicode code points (ADR-0003). */
const length = (s: string): number => [...s].length;

/** Fields the server owns; a client may never send them. */
export const READ_ONLY_FIELDS = ['id', 'teamId', 'authorId', 'version', 'createdAt', 'updatedAt', 'deletedAt'];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function checkTitle(v: unknown, errors: FieldError[]): string | undefined {
  if (typeof v !== 'string') {
    errors.push({ field: 'title', message: 'must be a string' });
    return undefined;
  }
  const t = v.trim();
  if (length(t) < 1 || length(t) > TITLE_MAX) {
    errors.push({ field: 'title', message: `must be 1-${TITLE_MAX} characters after trimming` });
    return undefined;
  }
  return t;
}

function checkBody(v: unknown, errors: FieldError[]): string | undefined {
  if (typeof v !== 'string') {
    errors.push({ field: 'body', message: 'must be a string' });
    return undefined;
  }
  if (length(v) > BODY_MAX) {
    errors.push({ field: 'body', message: `must be at most ${BODY_MAX} characters` });
    return undefined;
  }
  return v;
}

function unknownFields(input: Record<string, unknown>, allowed: string[], errors: FieldError[]): void {
  for (const k of Object.keys(input)) {
    if (READ_ONLY_FIELDS.includes(k)) errors.push({ field: k, message: 'read-only field' });
    else if (!allowed.includes(k)) errors.push({ field: k, message: 'unknown field' });
  }
}

const notAnObject: FieldError = { field: '$', message: 'request body must be a JSON object' };

export function validateCreate(input: unknown): Result<NoteCreate> {
  if (!isPlainObject(input)) return { ok: false, errors: [notAnObject] };
  const errors: FieldError[] = [];
  unknownFields(input, ['title', 'body'], errors);
  const title = 'title' in input ? checkTitle(input.title, errors) : (errors.push({ field: 'title', message: 'is required' }), undefined);
  const body = 'body' in input ? checkBody(input.body, errors) : '';
  if (errors.length > 0 || title === undefined || body === undefined) return { ok: false, errors };
  return { ok: true, value: { title, body } };
}

export function validatePatch(input: unknown): Result<NotePatch> {
  if (!isPlainObject(input)) return { ok: false, errors: [notAnObject] };
  const errors: FieldError[] = [];
  unknownFields(input, ['title', 'body'], errors);
  const value: NotePatch = {};
  if ('title' in input) { const t = checkTitle(input.title, errors); if (t !== undefined) value.title = t; }
  if ('body' in input) { const b = checkBody(input.body, errors); if (b !== undefined) value.body = b; }
  if (Object.keys(input).length === 0) errors.push({ field: '$', message: 'at least one field is required' });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
