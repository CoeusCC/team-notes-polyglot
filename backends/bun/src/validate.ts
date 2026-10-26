// Pure validation of request bodies. No I/O.
import { codePoints, trimWhiteSpace } from './text.ts';

export type FieldError = { field: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const READ_ONLY = new Set(['id', 'teamId', 'authorId', 'version', 'createdAt', 'updatedAt', 'deletedAt']);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkTitle(v: unknown, errors: FieldError[], max = 200, field = 'title'): string | undefined {
  if (typeof v !== 'string') { errors.push({ field, message: 'must be a string' }); return undefined; }
  const t = trimWhiteSpace(v);
  const n = codePoints(t);
  if (n < 1 || n > max) { errors.push({ field, message: `must be 1-${max} characters after trimming` }); return undefined; }
  return t;
}

function noteFields(o: Record<string, unknown>, errors: FieldError[]) {
  const out: { title?: string; body?: string } = {};
  for (const k of Object.keys(o)) {
    if (k === 'title') out.title = checkTitle(o.title, errors);
    else if (k === 'body') {
      if (typeof o.body !== 'string') errors.push({ field: 'body', message: 'must be a string' });
      else if (codePoints(o.body) > 100000) errors.push({ field: 'body', message: 'must be at most 100000 characters' });
      else out.body = o.body;
    } else if (READ_ONLY.has(k)) errors.push({ field: k, message: 'is read-only' });
    else errors.push({ field: k, message: 'unknown field' });
  }
  return out;
}

export function validateNoteCreate(v: unknown): Result<{ title: string; body: string }> {
  if (!isObject(v)) return { ok: false, errors: [{ field: '$', message: 'must be a JSON object' }] };
  const errors: FieldError[] = [];
  const f = noteFields(v, errors);
  if (!Object.hasOwn(v, 'title')) errors.push({ field: 'title', message: 'is required' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title: f.title!, body: f.body ?? '' } };
}

export function validateNotePatch(v: unknown): Result<{ title?: string; body?: string }> {
  if (!isObject(v)) return { ok: false, errors: [{ field: '$', message: 'must be a JSON object' }] };
  if (Object.keys(v).length === 0) return { ok: false, errors: [{ field: '$', message: 'must have at least one property' }] };
  const errors: FieldError[] = [];
  const f = noteFields(v, errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: f };
}

export function validateTeamCreate(v: unknown): Result<{ id: string; name: string }> {
  if (!isObject(v)) return { ok: false, errors: [{ field: '$', message: 'must be a JSON object' }] };
  const errors: FieldError[] = [];
  let id: string | undefined;
  let name: string | undefined;
  for (const k of Object.keys(v)) {
    if (k === 'id') {
      if (typeof v.id !== 'string' || !/^[a-z0-9-]{3,40}$/.test(v.id)) errors.push({ field: 'id', message: 'must match ^[a-z0-9-]{3,40}$' });
      else id = v.id;
    } else if (k === 'name') name = checkTitle(v.name, errors, 80, 'name');
    else errors.push({ field: k, message: 'unknown field' });
  }
  if (!Object.hasOwn(v, 'id')) errors.push({ field: 'id', message: 'is required' });
  if (!Object.hasOwn(v, 'name')) errors.push({ field: 'name', message: 'is required' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { id: id!, name: name! } };
}
