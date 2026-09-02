import { normalize } from "./lexicon";
import { loadArtistMap } from "./tidal-graph";
import { isrcsForArtist } from "./musicbrainz";
import { trackArtists, trackByIsrc, type TidalArtist } from "./tidal";

/* ------------------------------------------------------------------
   From a name, typed, to a TIDAL artist id.

   The two doors already in this codebase both need an id to start from: a
   pasted link carries one, and the similar-artist crawl needs one to walk
   from. Free text has neither — only a name, possibly misspelled, possibly
   one this site's own crawl has never reached.

   The local artist map (`lib/tidal-graph.ts`) is checked first because it
   is free — no network, no rate limit — and it already holds the artists
   most sittings will land on. When it misses, the way in is the one
   `lib/tidal.ts` documents for exactly this: MusicBrainz can be searched by
   name, its recordings often carry an ISRC, and an ISRC resolves to a TIDAL
   track and, from there, a TIDAL artist.
   ------------------------------------------------------------------ */

export interface ResolvedArtist {
  id: string;
  /** TIDAL's spelling, for the screen to say what it found. */
  name: string;
}

/** ISRCs worth trying before giving up on a name. */
const ISRC_ATTEMPTS = 5;

function bestMatch(name: string, artists: TidalArtist[]): TidalArtist | null {
  if (artists.length === 0) return null;
  const key = normalize(name);
  const exact = artists.find((a) => normalize(a.name) === key);
  if (exact) return exact;
  // A track credited to more than one name (a feature, a duo) still counts
  // as a match if ours is among them — otherwise the leading name stands in,
  // since that is usually who a search for the tune actually found.
  return artists.find((a) => normalize(a.name).includes(key) || key.includes(normalize(a.name)))
    ?? artists[0];
}

/**
 * One name to one TIDAL artist, or nothing.
 *
 * Never throws: a name that cannot be placed is simply left out of the
 * taste rather than failing the whole request over one misspelling.
 */
export async function resolveArtistName(name: string): Promise<ResolvedArtist | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const map = await loadArtistMap();
  const local = map.artists[normalize(trimmed)];
  if (local) return { id: local.id, name: local.name };

  try {
    const isrcs = await isrcsForArtist(trimmed, ISRC_ATTEMPTS);
    for (const isrc of isrcs) {
      const track = await trackByIsrc(isrc);
      if (!track) continue;
      const artists = await trackArtists(track.id);
      const match = bestMatch(trimmed, artists);
      if (match && match.ownerType !== "USER") return { id: match.id, name: match.name };
    }
  } catch {
    // TIDAL or MusicBrainz having a bad moment is not worth failing the
    // whole taste over — the name is simply left unresolved.
  }

  return null;
}

/**
 * Names to TIDAL artists, resolved one at a time.
 *
 * Sequential, not parallel: MusicBrainz asks for no more than one request a
 * second from an unauthenticated client (`lib/musicbrainz.ts`), and a batch
 * of names run in parallel would each be queuing behind the same limiter
 * anyway — running them one after another is no slower and reads plainly.
 */
export async function resolveArtistNames(names: string[]): Promise<ResolvedArtist[]> {
  const resolved: ResolvedArtist[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    const found = await resolveArtistName(name);
    if (!found || seen.has(found.id)) continue;
    seen.add(found.id);
    resolved.push(found);
  }

  return resolved;
}
