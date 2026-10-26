// Pure note shaping. No I/O.

export type Note = {
  id: string;
  teamId: string;
  authorId: string;
  title: string;
  body: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Present only on deleted notes. */
  deletedAt?: string;
};

export type NoteRow = {
  seq: number;
  id: string;
  team_id: string;
  author_id: string;
  title: string;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type NewNoteInput = { id: string; teamId: string; authorId: string; title: string; body: string };

/** Row -> API shape. Lists exactly the Note schema fields (additionalProperties: false). */
export function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    teamId: row.team_id,
    authorId: row.author_id,
    title: row.title,
    body: row.body,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
  };
}

/** A brand-new note: version 1, both timestamps equal to `now` (ISO-8601 UTC, ms precision). */
export function newNoteFields(input: NewNoteInput, now: Date): Note {
  const ts = now.toISOString();
  return { ...input, version: 1, createdAt: ts, updatedAt: ts };
}
