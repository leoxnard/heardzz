import { shuffle } from "./daily";
import { candidatesForArtist, type Candidate } from "./tidal-candidates";
import {
  getPlaylist,
  playlistTracks,
  similarArtists,
  trackArtists,
  type TidalRef,
} from "./tidal";

/* ------------------------------------------------------------------
   From somebody's playlist to records they have not heard here.

   The shape of the problem: a visitor can hand over a public playlist,
   and nothing else. No listening history, no favourites — those need
   them to log in to TIDAL, and a bare profile link exposes nothing at
   all. A playlist they made public is the whole signal.

   What is done with it is deliberately not "play them their own
   playlist". Naming a record you already own is not a game. So the
   playlist is read for *who* they like, that set is widened along
   TIDAL's similar-artist edges, and the tunes come from the widened
   set — near enough to be fair, far enough to be worth guessing.

   Everything already in the library is dropped on the way through, so
   what comes back is only records this site cannot currently play.
   ------------------------------------------------------------------ */

/** Seed artists read off a playlist. More than this is a slower request. */
const SEED_TRACKS = 8;
/** Neighbours per seed. Twenty come back; the popular end is kept. */
const NEIGHBOURS = 6;
/** Artists actually asked for tunes. Each one is a TIDAL round trip. */
const ARTISTS = 12;

/*
 * Two floors, both set from what the rounds actually looked like.
 *
 * A sitting that produced "The Blue Rubatos — You Are" (0.27) and "Ken Hirai
 * — Nonfiction" (0.31) was unguessable; the Jamiroquai tunes in the same
 * sitting sat at 0.67 and were fine. For scale, Louis Armstrong is 0.87 and
 * Charlie Parker 0.77, so this is not a high bar — it is the bar between a
 * record somebody might have heard and one nobody has.
 *
 * The artist floor matters as much as the tune's: an "80s Hits Reloaded"
 * covers act clears no bar at all, and its tracks carry a real title that
 * looks perfectly guessable right up until you hear the recording.
 */
const MIN_TRACK_POPULARITY = 0.45;
const MIN_ARTIST_POPULARITY = 0.35;

export interface TasteResult {
  /** What the seed was called, for the screen to say what it read. */
  source: string;
  /** Artists the taste was widened to, in the order they were reached. */
  reached: string[];
  candidates: Candidate[];
}

/**
 * Artist ids to build a round out of.
 *
 * A playlist gives its tracks' artists; an artist link is its own seed. In
 * both cases the seeds themselves are kept as well as their neighbours —
 * somebody who put Coltrane on a playlist should get a shot at Coltrane.
 */
async function seedArtists(ref: TidalRef): Promise<{ ids: string[]; source: string }> {
  if (ref.kind === "artist") {
    return { ids: [ref.id], source: "that artist" };
  }

  if (ref.kind === "track") {
    const [credited] = await trackArtists(ref.id);
    return { ids: credited ? [credited.id] : [], source: credited?.name ?? "that track" };
  }

  const playlist = await getPlaylist(ref.id);
  if (!playlist) return { ids: [], source: "" };

  const tracks = await playlistTracks(ref.id);
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const track of tracks.slice(0, SEED_TRACKS)) {
    for (const artist of await trackArtists(track.id)) {
      if (artist.ownerType === "USER" || seen.has(artist.id)) continue;
      seen.add(artist.id);
      ids.push(artist.id);
    }
  }

  return { ids, source: playlist.name || "that playlist" };
}

export async function tasteFrom(ref: TidalRef): Promise<TasteResult> {
  const { ids, source } = await seedArtists(ref);
  if (ids.length === 0) return { source, reached: [], candidates: [] };

  /*
   * Seeds first, then neighbours — but the neighbours are ranked by how
   * well known they are before any of them is taken, not shuffled flat.
   * Similarity alone wanders: four hops from a famous name is still
   * "similar" and is nobody anyone has heard of, which is how a round ends
   * up asking about a covers act.
   */
  const seen = new Set(ids);
  const neighbours: { id: string; popularity: number }[] = [];

  for (const id of ids) {
    let found = [];
    try {
      found = await similarArtists(id);
    } catch {
      continue;
    }
    for (const artist of found.slice(0, NEIGHBOURS)) {
      if (artist.ownerType === "USER" || seen.has(artist.id)) continue;
      if (artist.popularity < MIN_ARTIST_POPULARITY) continue;
      seen.add(artist.id);
      neighbours.push({ id: artist.id, popularity: artist.popularity });
    }
  }

  neighbours.sort((a, b) => b.popularity - a.popularity);
  const pool: string[] = [...ids, ...neighbours.map((n) => n.id)];

  /*
   * Varied on purpose. Taking the seeds and the most popular tunes every
   * time makes one playlist produce one sitting for ever — play it twice
   * and it is the same six records. So the artists are shuffled below the
   * seeds, and the tunes are drawn from a wider band than the top three.
   */
  const seed = Date.now();
  /*
   * Shuffled only inside the well-known end of the list. Taking them in
   * popularity order would make one playlist produce one sitting for ever;
   * shuffling the whole list would put the obscure tail back in.
   */
  const near = pool.slice(ids.length, ids.length + ARTISTS * 2);
  const ordered = [...shuffle(ids, seed), ...shuffle(near, seed + 1)];

  const candidates: Candidate[] = [];
  const reached: string[] = [];
  const seenArtist = new Set<string>();

  for (const id of ordered.slice(0, ARTISTS)) {
    const report = await candidatesForArtist(id);
    if (!report || report.candidates.length === 0) continue;
    // Two names can fold to one artist; listing it twice reads as a bug.
    if (seenArtist.has(report.artist)) continue;
    seenArtist.add(report.artist);

    reached.push(report.artist);
    // Only tunes somebody might name, and shuffled among those so the same
    // artist does not always offer the same one.
    const known = report.candidates.filter((c) => c.popularity >= MIN_TRACK_POPULARITY);
    candidates.push(...shuffle(known, seed + Number(id)).slice(0, 4));
  }

  return { source, reached, candidates: shuffle(candidates, seed) };
}
