import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { AUDIO_DIR } from "./paths";
import { slug } from "./slug";
import type { Solo } from "./types";
import type { Candidate } from "./tidal-candidates";

/* ------------------------------------------------------------------
   Rounds that are played once and then thrown away.

   A record fetched for one visitor is not a library entry. Nobody has
   heard it, nobody has confirmed where the tune starts, and it was
   chosen for one person's taste rather than for the game. So it never
   reaches data/solos.json: the clip is cut under a reserved prefix,
   played, and swept up on the next request that comes along.

   The prefix is what makes the sweep safe. `isSafeAudioName` already
   lets these through, so they serve over the existing audio route with
   no new door into the filesystem — and anything under the prefix is
   known to be disposable, which is exactly what a cleanup needs to be
   sure of before it deletes.
   ------------------------------------------------------------------ */

/** Reserved. A library slug never starts with this. */
export const EPHEMERAL_PREFIX = "tmp-";

/** Long enough to finish a sitting, short enough not to be storage. */
const TTL_MS = 2 * 60 * 60 * 1000;

export function ephemeralId(youtubeId: string, song: string): string {
  // The YouTube id makes it unique; the slug makes the directory readable.
  return `${EPHEMERAL_PREFIX}${slug(youtubeId)}-${slug(song)}`.slice(0, 100);
}

export function isEphemeral(id: string): boolean {
  return id.startsWith(EPHEMERAL_PREFIX);
}

/**
 * Drop expired clips. Called opportunistically rather than scheduled —
 * there is no cron here, and the next visitor is a good enough broom.
 */
export async function sweep(): Promise<number> {
  let removed = 0;
  let names: string[] = [];
  try {
    names = await readdir(AUDIO_DIR);
  } catch {
    return 0;
  }

  const cutoff = Date.now() - TTL_MS;
  for (const name of names) {
    if (!name.startsWith(EPHEMERAL_PREFIX)) continue;
    const file = path.join(AUDIO_DIR, name);
    try {
      const { mtimeMs } = await stat(file);
      if (mtimeMs < cutoff) {
        await rm(file, { force: true });
        removed++;
      }
    } catch {
      // A file that vanished under us is a file we wanted gone.
    }
  }
  return removed;
}

export interface Cut {
  audio: string;
  soloStart: number;
  leadIn: number;
  clipDuration: number;
  sourceDuration: number;
}

/**
 * A candidate plus its cut, in the shape the game already plays.
 *
 * `Game` takes `Solo[]` and asks nothing about where they came from, so a
 * throwaway round can reuse the whole board rather than growing a second
 * one. `verified` is false and there is no solo clip: nobody marked this,
 * and the only honest thing to play is the opening.
 */
export function toSolo(
  candidate: Candidate,
  youtubeId: string,
  cut: Cut,
  album?: string,
): Solo {
  return {
    id: ephemeralId(youtubeId, candidate.song),
    catalog: "",
    artist: candidate.artist,
    song: candidate.song,
    album: album ?? "",
    /*
     * Left at zero even though TIDAL offers one. Its date belongs to the
     * pressing, and for a reissue that is decades off — the sleeve would
     * then state a year the record was not made in. Absent beats wrong, and
     * the reveal hides the year when there is none.
     */
    year: 0,
    personnel: [],
    soloist: candidate.artist,
    soloistRole: "",
    youtubeId,
    isrc: candidate.isrc ?? undefined,
    tidalArtistId: candidate.tidalArtistId,
    soloStart: cut.soloStart,
    audio: cut.audio,
    leadIn: cut.leadIn,
    clipDuration: cut.clipDuration,
    sourceDuration: cut.sourceDuration,
    verified: false,
  };
}
