// Pure text helpers: Unicode White_Space trimming, code-point counting, I-JSON scalar checks.

// Unicode White_Space property (not U+200B ZWSP, not U+FEFF).
const WS = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

export function trimWhiteSpace(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && WS.has(s.charCodeAt(a))) a++;
  while (b > a && WS.has(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

/** Code points in a string with no lone surrogates: UTF-16 units minus low surrogates. */
export function codePoints(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xdc00 || c > 0xdfff) n++;
  }
  return n;
}

export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      else return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

/** True if any string (key or value) anywhere in a parsed JSON tree is not a sequence of scalar values. */
export function treeHasLoneSurrogate(v: unknown): boolean {
  if (typeof v === 'string') return hasLoneSurrogate(v);
  if (Array.isArray(v)) return v.some(treeHasLoneSurrogate);
  if (v && typeof v === 'object')
    return Object.keys(v).some((k) => hasLoneSurrogate(k) || treeHasLoneSurrogate((v as Record<string, unknown>)[k]));
  return false;
}

/** If-Match (RFC 9110 strong comparison): comma-separated list of entity tags, byte-equal match only. */
export function ifMatchVerdict(header: string | null, currentTag: string): 'missing' | 'wildcard' | 'match' | 'nomatch' {
  if (header === null) return 'missing';
  const entries = header.split(',').map((e) => e.trim());
  if (entries.includes('*')) return 'wildcard';
  return entries.some((e) => e === currentTag) ? 'match' : 'nomatch';
}
