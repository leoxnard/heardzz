import { cleanName } from "./clean";
import { shuffle } from "./daily";
import { recordKey } from "./duplicates";
import { canonical, ARTISTS, SONGS } from "./lexicon";
import { loadSolos } from "./library";
import type { PlayedTrack } from "./lastfm";
import type { Candidate } from "./tidal-candidates";

/* ------------------------------------------------------------------
   From what somebody has played to a round they can actually win.

   The other way of building a round — `lib/tidal-candidates.ts` — starts
   from an artist and asks TIDAL what they recorded. This one starts from
   the listener and asks nothing: the tunes are the ones already in their
   history, so the question is not "what might they know" but "what do we
   know they have played, and how often".

   That is the whole difference between the two difficulties. Widening a
   taste finds records worth discovering and regularly finds records
   nobody could name — the floors in `lib/taste.ts` exist because a
   sitting produced "The Blue Rubatos — You Are" at 0.27 popularity. A
   scrobble count cannot produce that: a tune played sixty times is one
   this listener can name, whatever the rest of the world thinks of it.

   Everything else is the same treatment the TIDAL side gives its
   candidates, and for the same reasons: the paperwork comes off the
   titles, the spelling settles on the lexicon's so answers autocomplete,
   and anything already in the library goes.
   ------------------------------------------------------------------ */

const SONG_KEYS = new Set(SONGS.map((song) => recordKey("", song)));

export interface PlayedReport {
  candidates: Candidate[];
  /** Why the rest went, so a thin round is explainable rather than mysterious. */
  skipped: { alreadyInLibrary: number; duplicate: number };
}

/**
 * Scrobbles to candidates, in an order that is not the same twice.
 *
 * Playcount decides who gets in — the list arrives most-played first and is
 * cut at whatever the caller asked for — but not what order they are played
 * in. Taking them in playcount order would make one profile produce one
 * sitting for ever, so the survivors are shuffled, exactly as
 * `tasteFromArtistIds` shuffles the artists it reaches.
 */
export async function candidatesFromPlayed(played: PlayedTrack[]): Promise<PlayedReport> {
  const solos = await loadSolos();
  const taken = new Set(solos.map((solo) => recordKey(solo.artist, solo.song)));
  const seen = new Set<string>();
  const skipped = { alreadyInLibrary: 0, duplicate: 0 };
  const candidates: Candidate[] = [];

  /*
   * The yardstick for `popularity` below. Scaling against the listener's
   * own top tune rather than a fixed number keeps the field meaning the
   * same thing for somebody with a hundred thousand scrobbles and somebody
   * with two hundred.
   */
  const most = Math.max(...played.map((track) => track.playcount), 1);

  for (const track of played) {
    /*
     * Deliberately not `leadName`, which the TIDAL side uses here.
     *
     * The two sources hand over different things under the same word. TIDAL
     * bills a track to everyone on the date, so its "artist" arrives as a
     * list — "Electric Groove Machine, Derrick McKenzie, Simon Katz, …" —
     * and `leadName` cuts it down to the one name a player would type. A
     * scrobble carries no billing at all: it is the single name the tag
     * said, and its separators are part of it. Reducing it does not find a
     * leader, it damages the name — measured against one real history, it
     * turned AC/DC into "AC", PJ & Duncan into "PJ", and DJ Jazzy Jeff &
     * The Fresh Prince into "DJ Jazzy Jeff", which are three rounds nobody
     * can answer.
     *
     * Comparison is unaffected: `recordKey` folds both sides through
     * `artistKey` below, so a name kept whole here still matches the same
     * record in the library.
     */
    const artist = canonical(cleanName(track.artist), ARTISTS);
    const song = canonical(cleanName(track.song), SONGS);
    const key = recordKey(artist, song);

    if (taken.has(key)) {
      skipped.alreadyInLibrary++;
      continue;
    }
    if (seen.has(key)) {
      skipped.duplicate++;
      continue;
    }
    seen.add(key);

    candidates.push({
      artist,
      song,
      /*
       * Neither is known here, and neither has to be. The ISRC only ever
       * reached the sleeve, and the album the reveal asks TIDAL for is
       * fetched inside a try/catch that costs a line rather than a round
       * (`app/api/foryou/fetch`). What the fetch genuinely depends on is
       * the duration, and Last.fm states that.
       */
      isrc: null,
      tidalArtistId: "",
      tidalTrackId: "",
      durationSec: track.durationSec,
      /*
       * The same 0–1 shape TIDAL's popularity has, measured on a different
       * axis: how well this listener knows the tune, not how well the world
       * does. That is the axis the easy round is built on, and the reason
       * it does not need the popularity floors the widened round does.
       */
      popularity: track.playcount / most,
      knownSong: SONG_KEYS.has(recordKey("", song)),
    });
  }

  return { candidates: shuffle(candidates, Date.now()), skipped };
}
