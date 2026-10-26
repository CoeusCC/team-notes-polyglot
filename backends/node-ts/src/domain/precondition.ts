// Pure If-Match parsing (ADR-0002, ADR-0005). No I/O.

/**
 * RFC 9110 strong comparison on the opaque ETag string, for a comma-separated list.
 * null -> precondition required (header missing, empty, or any entry is `*`): 428.
 * number[] -> the versions whose strong tag `"n"` appears byte-for-byte in the list.
 *   Weak tags, `"01"`, unquoted `1` and junk contribute nothing; an empty array can never match (412).
 */
export function parseIfMatch(header: string | undefined): number[] | null {
  const h = header?.trim();
  if (h === undefined || h === '') return null;
  const entries = h.split(',').map((e) => e.trim());
  if (entries.includes('*')) return null;
  const versions: number[] = [];
  for (const e of entries) {
    const m = /^"([1-9]\d{0,14})"$/.exec(e);
    if (m) versions.push(Number(m[1]));
  }
  return versions;
}

export const etag = (version: number): string => `"${version}"`;
