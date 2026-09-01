import { ARTISTS, ARTIST_ALIASES } from "./artists";
import { SONGS } from "./songs";

export { ARTISTS, ARTIST_ALIASES, SONGS };

/**
 * Fold a name down to something two people typing the same answer will agree
 * on: no case, no accents, no punctuation, no leading article. "Round Midnight",
 * "'Round Midnight" and "round midnight" all land on the same string.
 */
export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Typo budget scaled to length. One slip is forgiven in a short name, two in a
 * long one — enough for "Coltraine" or "Adderly", not enough to let a wrong
 * answer through.
 */
function withinTypoBudget(a: string, b: string): boolean {
  const budget = a.length <= 6 ? 0 : a.length <= 12 ? 1 : 2;
  if (budget === 0) return false;
  if (Math.abs(a.length - b.length) > budget) return false;
  return levenshtein(a, b) <= budget;
}

export function isMatch(guess: string, answer: string, aliases: string[] = []): boolean {
  const g = normalize(guess);
  if (!g) return false;

  const candidates = [answer, ...aliases].map(normalize);
  if (candidates.includes(g)) return true;
  return candidates.some((candidate) => withinTypoBudget(candidate, g));
}

export function artistMatches(guess: string, answer: string): boolean {
  return isMatch(guess, answer, ARTIST_ALIASES[answer] ?? []);
}

export function songMatches(guess: string, answer: string): boolean {
  return isMatch(guess, answer);
}

/* ------------------------------------------------------------------
   Suggestions
   ------------------------------------------------------------------ */

export interface Suggestion {
  value: string;
  /** Character range in `value` that matched, for highlighting. */
  from: number;
  to: number;
}

const MIN_QUERY = 2;

/**
 * Ranked: names starting with the query, then names whose later word starts
 * with it, then anything containing it. Nothing is returned below two
 * characters, so the list can never be browsed as a menu of answers.
 */
export function suggest(query: string, pool: string[], limit = 8): Suggestion[] {
  const q = normalize(query);
  if (q.length < MIN_QUERY) return [];

  const exact: Suggestion[] = [];
  const wordStart: Suggestion[] = [];
  const contains: Suggestion[] = [];

  for (const value of pool) {
    const n = normalize(value);
    const idx = n.indexOf(q);
    if (idx === -1) continue;

    // Map the hit back onto the original string well enough to underline it.
    const rawIdx = findRawIndex(value, q);
    const hit: Suggestion = {
      value,
      from: rawIdx,
      to: rawIdx + query.trim().length,
    };

    if (idx === 0) exact.push(hit);
    else if (n[idx - 1] === " ") wordStart.push(hit);
    else contains.push(hit);

    if (exact.length >= limit) break;
  }

  return [...exact, ...wordStart, ...contains].slice(0, limit);
}

function findRawIndex(value: string, normalizedQuery: string): number {
  const lower = value.toLowerCase();
  const firstToken = normalizedQuery.split(" ")[0];
  const idx = lower.indexOf(firstToken);
  return idx === -1 ? 0 : idx;
}

/** Library entries are always suggestible, even if the lexicon omits them. */
export function buildPool(base: string[], fromLibrary: string[]): string[] {
  return Array.from(new Set([...base, ...fromLibrary])).sort((a, b) =>
    a.localeCompare(b),
  );
}
