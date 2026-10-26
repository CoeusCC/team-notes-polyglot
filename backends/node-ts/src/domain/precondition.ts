// Pure If-Match parsing (ADR-0002). No I/O.

/**
 * The version a PATCH expects, from its If-Match header.
 * null  -> precondition required (header missing or `*`): 428.
 * n >= 1 -> the strong ETag `"n"`.
 * 0     -> present but can never match (weak, malformed, a list): compares stale, 412. Versions start at 1.
 */
export function parseIfMatch(header: string | undefined): number | null {
  const h = header?.trim();
  if (h === undefined || h === '' || h === '*') return null;
  const m = /^"(\d+)"$/.exec(h);
  return m ? Number(m[1]) : 0;
}

export const etag = (version: number): string => `"${version}"`;
