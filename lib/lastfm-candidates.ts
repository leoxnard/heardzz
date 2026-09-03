import { cleanName } from "./clean";
import { mulberry32 } from "./daily";
import { recordKey } from "./duplicates";
import { canonical, ARTISTS, SONGS } from "./lexicon";
import { loadSolos } from "./library";
import type { FoundTrack } from "./lastfm";
import type { Candidate } from "./tidal-candidates";

/* ------------------------------------------------------------------
   From a list of tunes to a round, without TIDAL in the middle.

   The other way of building a round — `lib/tidal-candidates.ts` — starts
   from an artist and asks TIDAL what they recorded, which costs a
   name-to-id resolution before it can start. Everything here arrives
   already naming its own artist and stating its own length, so there is
   nothing to resolve and nothing to look up.

   Three sources land in this one function because they answer in the same
   shape, and they are the three difficulties:

   what somebody has played, which is the easy round — a tune played sixty
   times is one they can name, whatever the rest of the world thinks of
   it; what sits next to what they play (`track.getSimilar`), which is the
   middle one; and what a tag is best known for (`tag.getTopTracks`),
   which needs no account at all.

   The floors in `lib/taste.ts` exist because widening a taste four hops
   found "The Blue Rubatos — You Are" at 0.27 popularity. None of these
   three can wander that far: each one is anchored to something a person
   actually named or actually played.

   Everything else is the same treatment the TIDAL side gives its
   candidates, and for the same reasons: the paperwork comes off the
   titles, the spelling settles on the lexicon's so answers autocomplete,
   and anything already in the library goes.
   ------------------------------------------------------------------ */

const SONG_KEYS = new Set(SONGS.map((song) => recordKey("", song)));

export interface TrackReport {
  candidates: Candidate[];
  /** Why the rest went, so a thin round is explainable rather than mysterious. */
  skipped: { alreadyInLibrary: number; duplicate: number; unusable: number };
}

/**
 * Draw an order at random, but let weight pull toward the front.
 *
 * A flat shuffle was wrong here, and wrong in a way that took a real
 * history to see. Scrobble counts are not spread evenly: of one listener's
 * top two hundred, a hundred and twelve sat at five to nine plays and
 * three sat above fifty. Shuffling that flat means five rounds in six come
 * off the thin end — so a mode whose whole promise is "records you know"
 * spent its time on tunes played once through a playlist. The listener
 * said so, and the profile agreed with him.
 *
 * `lib/taste.ts` had already met this and said it plainly: shuffling the
 * whole list puts the obscure tail back in. It shuffles inside a band to
 * avoid that; this does it with weights, because here every tune is a
 * candidate and only the odds should differ.
 *
 * Squared on purpose. Weighting by the count alone still left a third of
 * the draw in that thin end, because there is so much more of it; squaring
 * puts it near a tenth and lets the records somebody actually knows lead.
 * The tail is still reachable, so two sittings are never the same.
 *
 * (Efraimidis–Spirakis: an exponential race, one key per item, sorted. A
 * weighted shuffle without replacement in one pass.)
 */
function weightedOrder(candidates: Candidate[], seed: number): Candidate[] {
  const random = mulberry32(seed);
  return candidates
    .map((candidate) => ({
      candidate,
      // 1 - random() so a zero never reaches the logarithm.
      key: -Math.log(1 - random()) / Math.max(candidate.popularity ** 2, 1e-6),
    }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.candidate);
}

/**
 * Tunes to candidates, ordered so the best-known lead but nothing is fixed.
 */
export async function candidatesFromTracks(played: FoundTrack[]): Promise<TrackReport> {
  const solos = await loadSolos();
  const taken = new Set(solos.map((solo) => recordKey(solo.artist, solo.song)));
  const seen = new Set<string>();
  const skipped = { alreadyInLibrary: 0, duplicate: 0, unusable: 0 };
  const candidates: Candidate[] = [];

  /*
   * The yardstick for `popularity` below. Scaling against the listener's
   * own top tune rather than a fixed number keeps the field meaning the
   * same thing for somebody with a hundred thousand scrobbles and somebody
   * with two hundred.
   */
  const most = Math.max(...played.map((track) => track.weight), 1);

  for (const track of played) {
    // The one thing every road here depends on — see `judge`.
    if (!track.durationSec) {
      skipped.unusable++;
      continue;
    }

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
      popularity: track.weight / most,
      knownSong: SONG_KEYS.has(recordKey("", song)),
    });
  }

  return { candidates: weightedOrder(candidates, Date.now()), skipped };
}
