import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { TIDAL_ARTISTS_PATH } from "./paths";
import { ARTISTS, normalize } from "./lexicon";
import { similarArtists, type TidalArtist } from "./tidal";

/* ------------------------------------------------------------------
   Reaching an artist without being able to search for one.

   TIDAL will not let this app search by name, so there is no way to ask
   "which artist is Ella Fitzgerald". What it will answer is "who sounds
   like the artist at this id" — and that is enough, because the answer is
   itself a list of ids. Start from one artist we can name, walk the
   similar-artist edges, and the jazz half of the catalogue arrives with
   its ids attached. Names are then matched against the lexicon locally.

   It is a crawl, so it is bounded twice — by depth and by a node budget —
   and the result is written down. Nobody should be doing this more than
   once in a while, and never while a page is loading.
   ------------------------------------------------------------------ */

export interface KnownArtist {
  id: string;
  /** TIDAL's spelling, kept for display; the key is the folded form. */
  name: string;
  popularity: number;
  /** True when the folded name is one the lexicon already lists. */
  inLexicon: boolean;
}

export interface TidalArtistMap {
  version: number;
  crawledAt: string | null;
  /** normalize(name) -> artist */
  artists: Record<string, KnownArtist>;
}

const EMPTY: TidalArtistMap = { version: 1, crawledAt: null, artists: {} };

/** Same read-from-disk-every-time contract as `lib/library.ts`. */
export async function loadArtistMap(): Promise<TidalArtistMap> {
  try {
    const parsed = JSON.parse(await readFile(TIDAL_ARTISTS_PATH, "utf8")) as TidalArtistMap;
    return {
      version: parsed.version ?? 1,
      crawledAt: parsed.crawledAt ?? null,
      artists: parsed.artists && typeof parsed.artists === "object" ? parsed.artists : {},
    };
  } catch {
    return { ...EMPTY, artists: {} };
  }
}

async function saveArtistMap(map: TidalArtistMap): Promise<void> {
  await mkdir(path.dirname(TIDAL_ARTISTS_PATH), { recursive: true });
  await writeFile(TIDAL_ARTISTS_PATH, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

/** The lexicon, folded once, so the crawl can test membership cheaply. */
const LEXICON_KEYS = new Set(ARTISTS.map(normalize));

/**
 * A listener's own artist page, which TIDAL marks `ownerType: USER`.
 *
 * These are not artists in any sense we need: the one this feature was
 * first pointed at had no albums, no tracks and no similar artists, and a
 * popularity of 0.039. They are dead ends, so they never enter the queue.
 */
function isRealArtist(artist: TidalArtist): boolean {
  return artist.ownerType !== "USER" && artist.name.trim().length > 0;
}

export interface CrawlOptions {
  seedId: string;
  /** How many edges out from the seed to walk. */
  maxDepth?: number;
  /** Hard ceiling on artists visited, so a crawl always terminates. */
  maxArtists?: number;
}

export interface CrawlResult {
  visited: number;
  found: number;
  matchedLexicon: number;
  map: TidalArtistMap;
}

/**
 * Breadth-first over similar artists, merged into whatever was found before.
 *
 * Merging rather than replacing means a second crawl from a different seed
 * widens the map instead of throwing the first one away — which is how you
 * cover a genre that adjacency alone does not connect in one hop.
 */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const maxDepth = options.maxDepth ?? 2;
  const maxArtists = options.maxArtists ?? 250;

  const map = await loadArtistMap();
  const seen = new Set<string>();
  let queue: string[] = [options.seedId];
  let visited = 0;
  let found = 0;

  for (let depth = 0; depth <= maxDepth && queue.length && visited < maxArtists; depth++) {
    const next: string[] = [];

    for (const id of queue) {
      if (visited >= maxArtists) break;
      if (seen.has(id)) continue;
      seen.add(id);
      visited++;

      let neighbours: TidalArtist[] = [];
      try {
        neighbours = await similarArtists(id);
      } catch {
        // An artist that cannot be expanded is not a reason to stop crawling.
        continue;
      }

      for (const artist of neighbours) {
        if (!isRealArtist(artist)) continue;

        const key = normalize(artist.name);
        if (!key) continue;

        if (!map.artists[key]) found++;
        map.artists[key] = {
          id: artist.id,
          name: artist.name,
          popularity: artist.popularity,
          inLexicon: LEXICON_KEYS.has(key),
        };

        if (!seen.has(artist.id)) next.push(artist.id);
      }
    }

    queue = next;
  }

  map.crawledAt = new Date().toISOString();
  await saveArtistMap(map);

  const matchedLexicon = Object.values(map.artists).filter((a) => a.inLexicon).length;
  return { visited, found, matchedLexicon, map };
}

/** The TIDAL id for a name the library already uses, if the crawl reached it. */
export async function findArtistId(name: string): Promise<KnownArtist | null> {
  const { artists } = await loadArtistMap();
  return artists[normalize(name)] ?? null;
}
