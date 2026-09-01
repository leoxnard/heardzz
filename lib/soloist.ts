import type { Credit } from "./types";

/* ------------------------------------------------------------------
   Who is actually playing.

   The name on the sleeve is the leader's, and often not the person you are
   listening to — "Moanin'" is an Art Blakey record and a Lee Morgan solo.
   The soloist therefore has to be picked out of the credits rather than
   inferred from the artist, and the leader is only the right answer when
   nothing better has been chosen.
   ------------------------------------------------------------------ */

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Settle a soloist against the credits.
 *
 * Returns the credited spelling whenever one matches, so the answer the game
 * checks and the name shown in the personnel list are the same string.
 */
export function resolveSoloist(
  preferred: string | undefined,
  artist: string,
  personnel: Credit[],
): { soloist: string; soloistRole?: string } {
  const wanted = normalize(preferred?.trim() || artist);
  const credit = personnel.find((entry) => normalize(entry.name) === wanted);

  if (credit) {
    return { soloist: credit.name, soloistRole: credit.role || undefined };
  }
  return { soloist: preferred?.trim() || artist };
}
