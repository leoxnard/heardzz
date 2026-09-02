import { cleanName } from "./clean";
import { leadName, recordKey } from "./duplicates";
import { canonical, ARTISTS, SONGS } from "./lexicon";
import { loadSolos } from "./library";
import { artistTracks, getArtist, type TidalTrack } from "./tidal";

/* ------------------------------------------------------------------
   From an artist to a shortlist worth fetching.

   TIDAL hands back every pressing of every tune an artist ever recorded,
   which is the right raw material and the wrong list to look at. Three
   things happen to it here, all of them with code the library already
   owns:

   the paperwork comes off the names (`cleanName`), so "So What
   (Remastered 2011)" is "So What"; the spelling settles on whatever the
   lexicon uses (`canonical`), so a candidate and the library row it will
   become are written the same way; and anything already in the library
   goes (`recordKey`), including the several pressings of one tune that
   `collapseBy=NONE` deliberately left in.

   What comes out is artist, title, ISRC and duration — and the last two
   are the point. They are what lets the YouTube step tell the record from
   a live take, a cover, or a full-album upload.
   ------------------------------------------------------------------ */

export interface Candidate {
  artist: string;
  song: string;
  isrc: string | null;
  /** Seconds, from TIDAL. The YouTube step refuses a hit that misses this. */
  durationSec: number | null;
  popularity: number;
  tidalArtistId: string;
  tidalTrackId: string;
  /** True when the lexicon already lists the tune, so answers will autocomplete. */
  knownSong: boolean;
}

export interface CandidateReport {
  artist: string;
  tidalArtistId: string;
  candidates: Candidate[];
  /** Why the rest went, so a thin list is explainable rather than mysterious. */
  skipped: { alreadyInLibrary: number; duplicatePressing: number; unusable: number };
}

const SONG_KEYS = new Set(SONGS.map((song) => recordKey("", song)));

/**
 * A track with no ISRC or no duration is not worth queueing: both of the
 * checks that keep a wrong YouTube hit out of the library depend on them.
 */
function usable(track: TidalTrack): boolean {
  return Boolean(track.title.trim()) && track.durationSec !== null;
}

export async function candidatesForArtist(artistId: string): Promise<CandidateReport | null> {
  const artist = await getArtist(artistId);
  if (!artist) return null;

  const tracks = await artistTracks(artistId);
  const solos = await loadSolos();

  const taken = new Set(solos.map((solo) => recordKey(solo.artist, solo.song)));
  const seen = new Set<string>();
  const skipped = { alreadyInLibrary: 0, duplicatePressing: 0, unusable: 0 };
  const candidates: Candidate[] = [];

  // The leader, not the whole billing — see leadName in lib/duplicates.ts.
  const artistName = canonical(leadName(artist.name), ARTISTS);

  for (const track of tracks) {
    if (!usable(track)) {
      skipped.unusable++;
      continue;
    }

    const song = canonical(cleanName(track.title), SONGS);
    const key = recordKey(artistName, song);

    if (taken.has(key)) {
      skipped.alreadyInLibrary++;
      continue;
    }
    if (seen.has(key)) {
      skipped.duplicatePressing++;
      continue;
    }
    seen.add(key);

    candidates.push({
      artist: artistName,
      song,
      isrc: track.isrc,
      durationSec: track.durationSec,
      popularity: track.popularity,
      tidalArtistId: artistId,
      tidalTrackId: track.id,
      knownSong: SONG_KEYS.has(recordKey("", song)),
    });
  }

  /*
   * Popular first. Not because popularity is quality, but because a tune
   * more people have heard is a fairer thing to be asked to name, and the
   * top of this list is what actually gets fetched.
   */
  candidates.sort((a, b) => b.popularity - a.popularity);

  return { artist: artistName, tidalArtistId: artistId, candidates, skipped };
}
