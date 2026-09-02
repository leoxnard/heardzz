/* ------------------------------------------------------------------
   MusicBrainz, used for exactly one thing: turning a name into an ISRC.

   TIDAL will not let this app search by name (see `lib/tidal.ts`), and the
   local artist map only holds however many artists a similar-artist crawl
   has reached so far. A name typed in free text — "Michael Brecker only" —
   is neither of those, so it needs a door in from the outside.

   MusicBrainz has the one thing TIDAL withholds: free-text search. It does
   not know TIDAL's ids, but recordings there often carry an ISRC, and
   `trackByIsrc` in `lib/tidal.ts` turns an ISRC into a TIDAL track — which
   carries the artist id this whole detour exists to find.
   ------------------------------------------------------------------ */

const API = "https://musicbrainz.org/ws/2";
/** Required by MusicBrainz's usage policy, and it is what keeps this from reading as a scraper. */
const USER_AGENT = "heardzz/1.0 (https://github.com/)";

/**
 * MusicBrainz asks for no more than one request a second from an
 * unauthenticated client. Same shape as the queue in `lib/tidal.ts`: calls
 * are serialized rather than sent as fast as the event loop allows.
 */
const MIN_GAP_MS = 1100;
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await work();
    } finally {
      lastCall = Date.now();
    }
  });
  queue = next.catch(() => {});
  return next;
}

interface RecordingSearch {
  recordings?: { score?: number; isrcs?: string[] }[];
}

/**
 * ISRCs for an artist's best-known recordings, best match first.
 *
 * Ordered by MusicBrainz's own search score, not by how well-known the tune
 * is — but only the first one that resolves against TIDAL matters to the
 * caller, so a short, score-ordered list is exactly what is needed.
 */
export async function isrcsForArtist(name: string, limit = 8): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];

  return serialize(async () => {
    const url = new URL(`${API}/recording/`);
    url.searchParams.set("query", `artist:"${trimmed}"`);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("inc", "isrcs");
    url.searchParams.set("limit", String(limit));

    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return [];

    const data = (await response.json()) as RecordingSearch;
    const isrcs: string[] = [];
    for (const recording of data.recordings ?? []) {
      for (const isrc of recording.isrcs ?? []) {
        if (!isrcs.includes(isrc)) isrcs.push(isrc);
      }
    }
    return isrcs;
  });
}
