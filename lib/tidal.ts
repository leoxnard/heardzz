/* ------------------------------------------------------------------
   TIDAL, as far as it will let us in.

   This is a read-only window onto TIDAL's catalogue, used at authoring
   time to decide which records are worth adding — never while anybody is
   playing. The game still never touches the network during a round.

   Two limits shaped everything here, and both were found by asking the
   API rather than by reading about it:

   Free-text search is not available to us. `/v2/searchResults/{query}`
   answers 400 INVALID_RESOURCE_ID for every query and every encoding,
   and a client-credentials token comes back with an empty `scope`. So
   nothing below looks a name up. The catalogue is reachable by
   identifier only, which is why `lib/tidal-graph.ts` crawls similar
   artists instead of searching for them.

   A listener's taste is not available to us either. Favourites, playlists
   and top artists need a user-context token; client credentials cannot
   see them. What this module offers is adjacency — "who sounds like
   this" — which turns out to be the more useful half anyway.
   ------------------------------------------------------------------ */

const AUTH_URL = "https://auth.tidal.com/v1/oauth2/token";
const API = "https://openapi.tidal.com/v2";

/**
 * The catalogue is licensed per country and the API insists on being told
 * which one. It changes availability and nothing else we care about.
 */
const COUNTRY = process.env.TIDAL_COUNTRY || "US";

/** JSON:API, and it is strict about being asked for by name. */
const ACCEPT = "application/vnd.api+json";

/**
 * Requests are spaced and never overlap. A crawl is hundreds of calls in a
 * row against somebody else's service, which is exactly the shape that gets
 * an app throttled, so it queues the way `scripts/discogs.mjs` does rather
 * than going as fast as the event loop allows.
 */
const MIN_GAP_MS = 350;
/** Attempts after a 429 before the request is allowed to fail. */
const RETRIES = 4;
const BACKOFF_MS = 700;
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
  // The chain must not break on a rejection, or every later call inherits it.
  queue = next.catch(() => {});
  return next;
}

export function tidalAvailable(): boolean {
  return Boolean(process.env.TIDAL_CLIENT_ID && process.env.TIDAL_CLIENT_SECRET);
}

export function tidalUnavailableReason(): string | null {
  if (tidalAvailable()) return null;
  return "TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET are not set.";
}

/* ------------------------------------------------------------------
   Token
   ------------------------------------------------------------------ */

let cached: { token: string; expiresAt: number } | null = null;

/**
 * A client-credentials token, kept until a minute before it expires.
 *
 * They last four hours, so a crawl of a few hundred artists runs on one.
 * The minute of headroom is there so a request that starts valid does not
 * finish expired.
 */
async function token(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const id = process.env.TIDAL_CLIENT_ID;
  const secret = process.env.TIDAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("TIDAL credentials are not configured");

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(`TIDAL auth failed (${response.status})`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("TIDAL auth returned no token");

  cached = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000,
  };
  return cached.token;
}

/** Dropped so a rotated secret does not have to wait out the old token. */
export function forgetTidalToken(): void {
  cached = null;
}

/* ------------------------------------------------------------------
   Requests
   ------------------------------------------------------------------ */

/**
 * One GET against the catalogue.
 *
 * `path` is built here from values this module has already validated —
 * never from anything a caller pasted. A 404 is an answer, not a failure:
 * plenty of artists simply have no similar artists, and the crawl needs to
 * carry on past them.
 */
async function get<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set("countryCode", COUNTRY);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  return serialize(async () => {
    /*
     * TIDAL rate-limits in bursts, not just on average, so spacing requests
     * evenly is not enough on its own — a run of catalogue reads earns a 429
     * however politely it is paced. Backing off and retrying is the only
     * thing that answers it; giving up would fail a whole sitting over one
     * request that would have succeeded a second later.
     */
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${await token()}`, Accept: ACCEPT },
      });

      if (response.status === 404) return null;

      if (response.status === 429 && attempt < RETRIES) {
        const after = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(after) && after > 0
          ? after * 1000
          : BACKOFF_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 8000)));
        continue;
      }

      if (!response.ok) {
        throw new Error(`TIDAL ${path} failed (${response.status})`);
      }
      return (await response.json()) as T;
    }
  });
}

/* ------------------------------------------------------------------
   Shapes

   JSON:API answers in `data` plus a flat `included` bag that has to be
   stitched back together. None of that shape escapes this module.
   ------------------------------------------------------------------ */

interface Resource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
}

interface Document {
  data?: Resource | Resource[];
  included?: Resource[];
}

export interface TidalArtist {
  id: string;
  name: string;
  popularity: number;
  /**
   * TIDAL lets a listener make an artist page for themselves. Those are
   * indistinguishable from a real artist until you look at this, and they
   * are almost always empty — no albums, no tracks, no similar artists.
   */
  ownerType: string | null;
}

export interface TidalTrack {
  id: string;
  title: string;
  isrc: string | null;
  /** Seconds. The reason the YouTube step can tell a take from a cover. */
  durationSec: number | null;
  popularity: number;
}

function toArtist(resource: Resource): TidalArtist {
  const a = resource.attributes ?? {};
  return {
    id: resource.id,
    name: String(a.name ?? ""),
    popularity: typeof a.popularity === "number" ? a.popularity : 0,
    ownerType: typeof a.ownerType === "string" ? a.ownerType : null,
  };
}

function toTrack(resource: Resource): TidalTrack {
  const a = resource.attributes ?? {};
  return {
    id: resource.id,
    title: String(a.title ?? ""),
    isrc: typeof a.isrc === "string" ? a.isrc : null,
    durationSec: iso8601ToSeconds(typeof a.duration === "string" ? a.duration : null),
    popularity: typeof a.popularity === "number" ? a.popularity : 0,
  };
}

function included(doc: Document | null, type: string): Resource[] {
  return (doc?.included ?? []).filter((entry) => entry.type === type);
}

/* ------------------------------------------------------------------
   The four calls we actually make
   ------------------------------------------------------------------ */

export async function getArtist(id: string): Promise<TidalArtist | null> {
  const doc = await get<Document>(`/artists/${encodeURIComponent(id)}`);
  const data = doc?.data;
  if (!data || Array.isArray(data)) return null;
  return toArtist(data);
}

/**
 * Who TIDAL thinks sounds like this artist — twenty names, and in jazz they
 * are good ones. This is the whole engine: with no search, adjacency is the
 * only way to reach an artist whose id we do not already have.
 */
export async function similarArtists(id: string): Promise<TidalArtist[]> {
  const doc = await get<Document>(
    `/artists/${encodeURIComponent(id)}/relationships/similarArtists`,
    { include: "similarArtists" },
  );
  return included(doc, "artists").map(toArtist);
}

/**
 * An artist's tracks.
 *
 * `collapseBy=NONE` is required — without it the call is a 400. NONE keeps
 * every pressing of a tune rather than folding them, which suits us: the
 * duplicate check downstream is better at deciding what is the same record
 * than TIDAL's collapsing is.
 */
export async function artistTracks(id: string): Promise<TidalTrack[]> {
  const doc = await get<Document>(
    `/artists/${encodeURIComponent(id)}/relationships/tracks`,
    { collapseBy: "NONE", include: "tracks" },
  );
  return included(doc, "tracks").map(toTrack);
}

/** Whoever is credited on a track — how a pasted track link finds its artist. */
export async function trackArtists(id: string): Promise<TidalArtist[]> {
  const doc = await get<Document>(
    `/tracks/${encodeURIComponent(id)}/relationships/artists`,
    { include: "artists" },
  );
  return included(doc, "artists").map(toArtist);
}

export interface TidalPlaylist {
  id: string;
  name: string;
  numberOfItems: number;
}

/**
 * A public playlist, by its UUID.
 *
 * This is the one door into somebody's taste that does not need them to log
 * in. Favourites and listening history are user-context only — a token from
 * client credentials cannot see them, and a bare profile link exposes
 * nothing. A playlist somebody made public is theirs, curated, and readable.
 */
export async function getPlaylist(uuid: string): Promise<TidalPlaylist | null> {
  const doc = await get<Document>(`/playlists/${encodeURIComponent(uuid)}`);
  const data = doc?.data;
  if (!data || Array.isArray(data)) return null;
  const a = data.attributes ?? {};
  return {
    id: data.id,
    name: String(a.name ?? ""),
    numberOfItems: typeof a.numberOfItems === "number" ? a.numberOfItems : 0,
  };
}

/** The tracks on a public playlist. One page is plenty to read a taste from. */
export async function playlistTracks(uuid: string): Promise<TidalTrack[]> {
  const doc = await get<Document>(
    `/playlists/${encodeURIComponent(uuid)}/relationships/items`,
    { include: "items" },
  );
  return included(doc, "tracks").map(toTrack);
}

export interface TidalAlbum {
  title: string;
  /**
   * The year *this release* came out — which for a reissue or an anthology
   * is not the year the record was made. Deliberately not written into a
   * round as the record's year: Discogs is the authority on that, and a
   * 1959 date is worse wrong than absent.
   */
  releaseYear: number;
}

/** The album a track sits on, for a reveal that has something on it. */
export async function trackAlbum(id: string): Promise<TidalAlbum | null> {
  const doc = await get<Document>(
    `/tracks/${encodeURIComponent(id)}/relationships/albums`,
    { include: "albums" },
  );
  const [album] = included(doc, "albums");
  if (!album) return null;

  const a = album.attributes ?? {};
  const released = typeof a.releaseDate === "string" ? a.releaseDate : "";
  return {
    title: String(a.title ?? ""),
    releaseYear: Number(released.slice(0, 4)) || 0,
  };
}

/** Kept for resolving a record we already hold an ISRC for. */
export async function trackByIsrc(isrc: string): Promise<TidalTrack | null> {
  if (!/^[A-Za-z0-9]{12}$/.test(isrc)) return null;
  const doc = await get<Document>("/tracks", { "filter[isrc]": isrc });
  const data = doc?.data;
  const first = Array.isArray(data) ? data[0] : data;
  return first ? toTrack(first) : null;
}

/* ------------------------------------------------------------------
   Input
   ------------------------------------------------------------------ */

export interface TidalRef {
  kind: "artist" | "track" | "playlist";
  id: string;
}

/**
 * Pull an id out of whatever someone pasted.
 *
 * Same reasoning as `lib/youtube.ts`: only the id travels. The URL is never
 * forwarded as typed — every request above is rebuilt from the id against a
 * hardcoded host, so a link pointing somewhere else cannot send the server
 * after it.
 */
const NUMERIC = /^\d{1,12}$/;
/** Playlists are UUIDs rather than numbers, so they parse separately. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTidalRef(input: string): TidalRef | null {
  const text = String(input || "").trim();
  if (NUMERIC.test(text)) return { kind: "artist", id: text };
  if (UUID.test(text)) return { kind: "playlist", id: text.toLowerCase() };

  const playlist = /tidal\.com\/(?:browse\/)?playlist\/([0-9a-f-]{36})/i.exec(text);
  if (playlist && UUID.test(playlist[1])) {
    return { kind: "playlist", id: playlist[1].toLowerCase() };
  }

  const match = /tidal\.com\/(?:browse\/)?(artist|track)\/(\d{1,12})/i.exec(text);
  if (!match) return null;

  return { kind: match[1].toLowerCase() as "artist" | "track", id: match[2] };
}

/** "PT2M34S" → 154. Durations arrive ISO-8601 and are compared in seconds. */
export function iso8601ToSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value.trim());
  if (!match) return null;

  const [, h, m, s] = match;
  if (h === undefined && m === undefined && s === undefined) return null;

  return Math.round(Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0));
}
