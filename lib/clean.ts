/* ------------------------------------------------------------------
   Names, as they should be stored.

   A YouTube title carries the upload's paperwork inside brackets — the
   remaster year, "Official Audio", the label, the take, the channel's own
   branding. None of it is the name of the tune, and all of it breaks
   matching: "So What (Remastered 2011)" and "So What" are the same record,
   and no key built out of those two strings agrees.

   So every bracket goes, whatever is in it, and the edges are trimmed. This
   runs on anything that becomes an artist or a song — the upload's tags, the
   parsed title, Gemini's answer, and whatever is typed into the form — so a
   name reaches the library in one shape only.

   `scripts/metadata.mjs` strips the same brackets while parsing a title,
   because it is plain ESM and cannot import this. The two are deliberately
   the same rule; this one is the authority.
   ------------------------------------------------------------------ */

/** A bracketed aside, closed. */
const BRACKETED = /[([{][^)\]}]*[)\]}]/g;

/** A bracket somebody opened and never closed — the tail is an aside too. */
const UNCLOSED = /[([{][^)\]}]*$/;

/**
 * Punctuation that only ever joined a title to something now deleted.
 * Apostrophes and full stops are left alone: "Moanin'" and "Mr. P.C." end
 * in them and mean it.
 */
const EDGE = /^[\s\-–—·|:,;]+|[\s\-–—·|:,;]+$/g;

/**
 * A title with its brackets removed and its edges tidied.
 *
 * Stripping never empties a name: an upload titled only "(Live)" keeps the
 * words it had rather than becoming a blank field nobody can search for.
 */
export function cleanName(value: string | null | undefined): string {
  const raw = String(value ?? "");
  const stripped = raw.replace(BRACKETED, " ").replace(UNCLOSED, " ");
  return tidy(stripped) || tidy(raw);
}

function tidy(value: string): string {
  return value.replace(/\s{2,}/g, " ").replace(EDGE, "").trim();
}

/** `cleanName` over a record's two answers, which is nearly every caller. */
export function cleanRecord<T extends { artist?: string; song?: string }>(record: T): T {
  return {
    ...record,
    ...(record.artist === undefined ? {} : { artist: cleanName(record.artist) }),
    ...(record.song === undefined ? {} : { song: cleanName(record.song) }),
  };
}
