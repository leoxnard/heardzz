/* ------------------------------------------------------------------
   Last.fm, for the one thing neither a playlist nor a typed name gives:
   what somebody actually listens to.

   The other two doors into a taste are both performances of one. A
   playlist is curated — it is what somebody assembled, on purpose, once,
   and often for other people to see. A few typed words are whoever came
   to mind while typing. A scrobble log is neither: it is years of
   listening counted while nobody was watching, which is the closest to a
   taste this app can be handed without asking anyone to log in.

   Read-only, and unauthenticated on purpose. Last.fm issues an API key
   and a shared secret together, but the secret exists to sign the session
   calls of the auth flow — scrobbling, loving a track, anything done *as*
   a user. Reading a public profile's top artists needs the key alone, so
   LASTFM_SHARED_SECRET is deliberately never read in this file: there is
   no callback URL, no redirect, and nobody has to log in to be read.

   What comes out is names, not ids. Last.fm has never heard of TIDAL, so
   the names leave here the same way a typed one does — through
   `lib/taste-text.ts`, which places a name against TIDAL by way of
   MusicBrainz — and the round is built from there by the same code that
   builds one from a pasted link.
   ------------------------------------------------------------------ */

const API = "https://ws.audioscrobbler.com/2.0/";

/**
 * Long-run listening rather than a recent streak.
 *
 * Last.fm will answer for a week or a month as well, and it is tempting:
 * recent listening is more alive. But it is also thin — a fortnight of one
 * record on repeat is not a taste — and the widening downstream already
 * supplies the variety, since `tasteFromArtistIds` shuffles the artists it
 * reaches. So this asks for the whole history and lets the shuffling be
 * somebody else's job.
 */
const PERIOD = "overall";

/**
 * No queue here, unlike its neighbours in `lib/tidal.ts` and
 * `lib/musicbrainz.ts`.
 *
 * Reading a taste is one call, and the widening below is a handful more,
 * made one after another rather than at once. Last.fm asks for a few
 * requests a second where MusicBrainz asks for one — an order of magnitude
 * of headroom — so a dozen sequential calls never come close, and a
 * limiter would be machinery guarding nothing.
 */
export function lastfmAvailable(): boolean {
  return Boolean(process.env.LASTFM_API_KEY);
}

export function lastfmUnavailableReason(): string | null {
  if (lastfmAvailable()) return null;
  return "LASTFM_API_KEY is not set.";
}

/**
 * Last.fm documents usernames as 2–15 characters of letters, digits,
 * underscore and hyphen. A little slack on the length, because accounts
 * predate the current rule and the API is the real judge of whether one
 * exists — but not on the alphabet.
 *
 * Same reasoning as `parseTidalRef`: only the name travels. The request
 * below is built with `URLSearchParams` against a hardcoded host, so a
 * stray character could never have escaped the query anyway; refusing it
 * here just means the screen can say something better than "no such user".
 */
const USERNAME = /^[A-Za-z0-9_-]{2,20}$/;

/** A bare username, or the profile link somebody copied out of the address bar. */
export function parseLastfmUser(input: string): string | null {
  const text = String(input || "").trim();
  const link = /last\.fm\/user\/([A-Za-z0-9_-]{2,20})/i.exec(text);
  const name = link ? link[1] : text;
  return USERNAME.test(name) ? name : null;
}

const NO_SUCH_USER = 6;

interface Fault {
  /**
   * Last.fm puts its own error code in the body and the status line is not
   * a reliable read of it — a missing user comes back 404, but so would a
   * service having a bad afternoon, and other faults answer 200. Code 6 is
   * "user not found", the one failure here that is the visitor's to fix
   * rather than ours, so the body is what gets believed.
   */
  error?: number;
  message?: string;
}

/**
 * One call, and the two failures worth telling apart.
 *
 * `null` means Last.fm has no such user — a wrong name, or a profile that
 * no longer exists, which is the visitor's to fix. Anything else throws,
 * and the route turns that into a 500 rather than blaming them for it.
 */
async function call<T extends Fault>(params: Record<string, string>): Promise<T | null> {
  const url = new URL(API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("api_key", process.env.LASTFM_API_KEY ?? "");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const data = (await response.json().catch(() => null)) as T | null;

  if (data?.error === NO_SUCH_USER) return null;
  if (!response.ok || !data || data.error) {
    throw new Error(data?.message || `Last.fm answered ${response.status}`);
  }
  return data;
}

/**
 * Last.fm's catalogue is user-written, so it carries the junk that implies.
 * These two are its own placeholders for a scrobble whose artist tag was
 * empty, and they resolve to nothing downstream.
 */
function usableName(name: string): boolean {
  return Boolean(name) && name !== "[unknown]" && name.toLowerCase() !== "various artists";
}

/**
 * A tune somebody has actually played, and how often.
 *
 * `durationSec` is the whole reason this is worth reading. Everything that
 * keeps a wrong YouTube upload out of a round runs off an expected length
 * (`judge` in `lib/tidal-youtube.ts`), and TIDAL was the only thing that
 * knew one — which is why a round has so far had to be built out of TIDAL's
 * catalogue even when the listener's own history was right there. Last.fm
 * states it, so a scrobble is enough on its own.
 */
export interface FoundTrack {
  artist: string;
  song: string;
  durationSec: number;
  /**
   * How strongly the tune belongs to whatever was asked for, on whatever
   * scale that source counts in — a playcount from a history, a 0–1 match
   * from a similarity, a rank from a tag. Never compared across sources;
   * `candidatesFromTracks` scales it against the best in its own list, so
   * only the ordering within one answer has to mean anything.
   */
  weight: number;
}

interface TopTracksResponse extends Fault {
  toptracks?: {
    track?: {
      name?: string;
      duration?: string;
      playcount?: string;
      artist?: { name?: string };
    }[];
  };
}

/**
 * The tunes somebody has played most, most-played first.
 *
 * Note the unit. `track.getInfo` answers in milliseconds and this answers
 * in seconds — the same recording is 345000 there and 345 here — so the
 * two are never mixed and only this one is read.
 *
 * A track with no length is dropped rather than carried with a null. The
 * duration check is the one thing standing between a round and a lyric
 * video, and a candidate that cannot be checked is not worth a download.
 * `null` for a missing user, exactly as `topArtists` does it.
 */
export async function topTracks(user: string, limit: number): Promise<FoundTrack[] | null> {
  const data = await call<TopTracksResponse>({
    method: "user.gettoptracks",
    user,
    period: PERIOD,
    limit: String(limit),
  });
  if (data === null) return null;

  const played: FoundTrack[] = [];

  for (const track of data.toptracks?.track ?? []) {
    const song = (track?.name ?? "").trim();
    const artist = (track?.artist?.name ?? "").trim();
    const durationSec = Number(track?.duration ?? 0);
    if (!song || !usableName(artist) || !durationSec) continue;

    played.push({
      artist,
      song,
      durationSec,
      weight: Number(track?.playcount ?? 0) || 0,
    });
  }

  return played;
}

/**
 * The shape both widening calls answer in: a list of tracks, each naming
 * its own artist and stating its own length.
 *
 * That last part is what makes these two worth having and
 * `artist.getTopTracks` not. Every road to a round ends at the duration
 * check in `judge`, and an endpoint that omits the length turns one call
 * into one call per track.
 */
interface TrackListResponse extends Fault {
  [key: string]: unknown;
}

function readTrackList(
  block: { track?: unknown } | undefined,
  weigh: (raw: Record<string, unknown>, index: number) => number,
): FoundTrack[] {
  const rows = Array.isArray(block?.track) ? (block.track as Record<string, unknown>[]) : [];
  const found: FoundTrack[] = [];

  rows.forEach((row, index) => {
    const song = String(row?.name ?? "").trim();
    const artist = String((row?.artist as { name?: string })?.name ?? "").trim();
    const durationSec = Number(row?.duration ?? 0);
    if (!song || !usableName(artist) || !durationSec) return;
    found.push({ artist, song, durationSec, weight: weigh(row, index) });
  });

  return found;
}

/**
 * Tunes Last.fm thinks sit next to this one.
 *
 * The middle difficulty is built out of this. Widening by artist the way
 * TIDAL does costs a name-to-id resolution before it can start, and then a
 * second call per artist to find anything with a length on it; this widens
 * by tune, arrives playable, and carries a `match` saying how far it went.
 *
 * The near end of that scale is mostly the same artist again — asking for
 * neighbours of "Giant Steps" answers with two more Coltrane sides before
 * it answers with anybody else — so the caller drops the seed's own artist
 * rather than trusting the score alone.
 */
export async function similarTracks(
  artist: string,
  song: string,
  limit: number,
): Promise<FoundTrack[]> {
  const data = await call<TrackListResponse>({
    method: "track.getsimilar",
    artist,
    track: song,
    limit: String(limit),
  });
  const block = data?.similartracks as { track?: unknown } | undefined;
  return readTrackList(block, (row) => Number(row?.match ?? 0) || 0);
}

/**
 * The best-known records under a tag — "hard bop", "bebop", "cool jazz".
 *
 * The one door here that needs nobody's account and nobody's playlist. A
 * tag Last.fm has never heard of is not an error, it is an empty list,
 * which is exactly the signal a caller wants for "that was not a genre".
 *
 * Weighted by rank, because the endpoint states no score of its own. The
 * list arrives best-known first and that ordering is the whole signal.
 */
export async function tagTracks(tag: string, limit: number): Promise<FoundTrack[]> {
  const data = await call<TrackListResponse>({
    method: "tag.gettoptracks",
    tag,
    limit: String(limit),
  });
  const block = data?.tracks as { track?: unknown } | undefined;
  return readTrackList(block, (_row, index) => limit - index);
}

interface TrackInfoResponse extends Fault {
  track?: { album?: { title?: string } };
}

/**
 * The album a tune sits on, for a reveal that has something on it.
 *
 * Stands in for `trackAlbum` in `lib/tidal.ts` wherever a round was built
 * without TIDAL — those candidates carry no track id, so the TIDAL call
 * has nothing to ask about and the sleeve came back blank.
 *
 * Never throws. Same bargain the TIDAL one strikes: failing costs the
 * sleeve a line, not the round.
 */
export async function albumFor(artist: string, song: string): Promise<string | null> {
  try {
    const data = await call<TrackInfoResponse>({ method: "track.getinfo", artist, track: song });
    return data?.track?.album?.title?.trim() || null;
  } catch {
    return null;
  }
}

interface UserInfoResponse extends Fault {
  user?: { playcount?: string };
}

/**
 * How much history there is, before a sitting is spent finding out there
 * is none.
 *
 * `null` for no such user. Cheap enough to ask first, and it turns "that
 * came back empty" into something the screen can actually explain.
 */
export async function scrobbleCount(user: string): Promise<number | null> {
  const data = await call<UserInfoResponse>({ method: "user.getinfo", user });
  if (data === null) return null;
  return Number(data.user?.playcount ?? 0) || 0;
}

interface SimilarArtistsResponse extends Fault {
  similarartists?: { artist?: { name?: string }[] };
}

/**
 * Who Last.fm thinks sounds like this artist, closest first.
 *
 * Not used to build rounds — `artist.getTopTracks` states no duration, so
 * widening this way costs a call per tune. It is used to make a round
 * harder: the five names offered on the easy levels were drawn at random
 * from the whole index, which puts a swing trumpeter beside a fusion
 * bassist and answers itself. Neighbours make four decoys that all belong.
 */
export async function similarArtists(artist: string, limit: number): Promise<string[]> {
  const data = await call<SimilarArtistsResponse>({
    method: "artist.getsimilar",
    artist,
    limit: String(limit),
  });
  const names: string[] = [];

  for (const row of data?.similarartists?.artist ?? []) {
    const name = (row?.name ?? "").trim();
    if (usableName(name)) names.push(name);
  }

  return names;
}

interface TopArtistsResponse extends Fault {
  topartists?: { artist?: { name?: string }[] };
}

/**
 * Somebody's most-played artists, most-played first.
 *
 * An empty list means the user is real but has never scrobbled anything,
 * which reads differently on screen and so is kept distinct from the miss.
 */
export async function topArtists(user: string, limit: number): Promise<string[] | null> {
  const data = await call<TopArtistsResponse>({
    method: "user.gettopartists",
    user,
    period: PERIOD,
    limit: String(limit),
  });
  if (data === null) return null;

  const names: string[] = [];
  const seen = new Set<string>();

  for (const artist of data.topartists?.artist ?? []) {
    const name = (artist?.name ?? "").trim();
    if (!usableName(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}
