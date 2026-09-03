import { cleanName } from "./clean";
import { ARTIST_ALIASES, isMatch, normalize } from "./lexicon";

/* ------------------------------------------------------------------
   Is this record already here?

   Slugging "song-artist" and comparing strings is too literal to be much
   use. The same record reaches this from a dozen uploads and each one
   spells it differently: "So What (Official Audio)", "So What - Take 1",
   "Miles Davis Sextet", "The Miles Davis Quintet", "Miles Davis & John
   Coltrane". None of those slugs match "so-what-miles-davis" and every one
   of them is the same tune by the same band.

   So both halves are folded first — brackets off, takes and remaster notes
   off, ensemble words off, aliases resolved — and the comparison happens on
   what is left. Kept apart from `tuneKey` in lib/slug.ts on purpose: that
   one groups the library list, where two spellings really are two rows,
   and this one refuses an import.
   ------------------------------------------------------------------ */

/**
 * Where a band name stops being the leader's. Everything after the first of
 * these is the rest of the marquee: "Art Blakey and the Jazz Messengers",
 * "Miles Davis & John Coltrane", "Bill Evans with Jim Hall".
 */
const JOINT = /\s*(?:[&,/]|\bwith\b|\bfeat\.?\b|\bfeaturing\b|\band his\b|\band her\b|\band the\b)\s*/i;

/**
 * Words a band adds to a leader's name without becoming a different band.
 * "Bill Evans Trio" and "Bill Evans" put out the same record.
 */
const ENSEMBLE =
  /\b(orchestra|big band|band|quintet|quartet|quintette|trio|duo|sextet|septet|octet|nonet|ensemble|group|combo|all stars?|allstars?|jazz messengers)\b/g;

/**
 * Suffixes that trail a name without changing whose it is.
 *
 * Only at the end, so nothing is taken out of the middle of a name. TIDAL
 * and Last.fm disagree about the comma in "Grover Washington, Jr." and
 * about whether the suffix is there at all, and a player types whichever
 * they remember — three spellings of one man that all have to land on him.
 */
const HONORIFIC = /\s+(jr|sr|ii|iii|iv)$/;

/**
 * Everything after these, when it trails a title, describes the transfer
 * rather than the tune: "So What - Take 2", "Blue in Green / Remastered".
 */
const TAKE =
  /\s*[-–—/|]\s*(take\s*\d+|alternate.*|alt\.?\s*take.*|remaster.*|remastered.*|mono.*|stereo.*|live.*|\d{4}\s*(digital\s*)?remaster.*|edit|single version|album version|instrumental)\s*$/i;

/** Trailing words that survive without a separator: "So What Remastered 2011". */
const TRAILING_NOISE = /\s+(remastered|remaster|mono|stereo|hd|hq)(\s+\d{4})?\s*$/i;

/** alias → the name the library actually stores. */
const CANONICAL: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(ARTIST_ALIASES)) {
    for (const alias of aliases) map.set(normalize(alias), canonical);
  }
  return map;
})();

function fold(value: string): string {
  return normalize(cleanName(value).replace(TAKE, "").replace(TRAILING_NOISE, ""));
}

/**
 * The name at the front of a billing, spelled as it was given.
 *
 * `artistKey` already splits on this to compare records, but it folds the
 * result to a key. The answer a player types needs the same split without
 * the folding: TIDAL bills a track to every name on the date, so a credit
 * arrives as "Electric Groove Machine, Derrick McKenzie, Simon Katz, ..." —
 * seven names, and an answer nobody is going to type. The leader is the
 * answer; the rest is the sleeve.
 */
export function leadName(artist: string): string {
  const cleaned = cleanName(artist);
  const lead = cleaned.split(JOINT)[0];
  return lead?.trim() || cleaned;
}

/** A tune title, folded down to the tune. */
export function songKey(song: string): string {
  return fold(song);
}

/**
 * A band name, folded down to whoever leads it.
 *
 * Aliases are resolved before the ensemble words come off, so a name the
 * lexicon knows under another spelling lands where the library keeps it.
 * Stripping can empty a name — "The Trio" is nothing but ensemble words —
 * and when it does the unstripped form is what gets compared.
 */
export function artistKey(artist: string): string {
  const lead = cleanName(artist).split(JOINT)[0] || cleanName(artist);
  const folded = normalize(lead);
  const canonical = CANONICAL.get(folded) ?? CANONICAL.get(fold(artist));
  const base = canonical ? normalize(canonical) : folded;
  const stripped = base
    .replace(ENSEMBLE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(HONORIFIC, "");
  return stripped || base;
}

/**
 * Two names for the same act, as far as the library is concerned.
 *
 * The same fold that decides whether two records are duplicates, offered to
 * whoever is checking an answer. `isMatch` in the lexicon compares the
 * names as written, which is right for a person's name and wrong the moment
 * a record is billed to an ensemble: "Louis Armstrong" and "Louis Armstrong
 * And His Orchestra" are one artist to this library and two strings to that
 * comparison.
 *
 * The two are then compared through `isMatch` rather than for equality, so
 * the typo budget survives the fold. Someone who drops a letter from
 * "Armstrong" has still named the act, and being told otherwise because the
 * record happened to be billed to an orchestra is the same unfairness this
 * function exists to undo.
 */
export function sameArtist(a: string, b: string): boolean {
  const left = artistKey(a);
  const right = artistKey(b);
  return Boolean(left) && Boolean(right) && isMatch(left, right);
}

/** The two halves together: what makes two entries the same record. */
export function recordKey(artist: string, song: string): string {
  return `${songKey(song)}|${artistKey(artist)}`;
}

/**
 * Entries that are already this record.
 *
 * Two ways to be the same record and both of them count: the same upload, or
 * the same tune by the same artist off a different upload. A record with
 * three soloists returns three entries — that is one record, marked again,
 * not three duplicates.
 */
export function findDuplicates<
  T extends { youtubeId: string; artist: string; song: string },
>(
  solos: T[],
  record: { youtubeId?: string; artist?: string; song?: string },
): T[] {
  const key = record.artist && record.song ? recordKey(record.artist, record.song) : null;

  return solos.filter((solo) => {
    if (record.youtubeId && solo.youtubeId === record.youtubeId) return true;
    return key !== null && recordKey(solo.artist, solo.song) === key;
  });
}
