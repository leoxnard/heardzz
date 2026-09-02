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
 * `lib/musicbrainz.ts`. Reading a taste is exactly one call to this
 * service — every request after it is somebody else's rate limit to
 * worry about — so there is nothing to serialize.
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
export interface PlayedTrack {
  artist: string;
  song: string;
  durationSec: number;
  playcount: number;
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
export async function topTracks(user: string, limit: number): Promise<PlayedTrack[] | null> {
  const data = await call<TopTracksResponse>({
    method: "user.gettoptracks",
    user,
    period: PERIOD,
    limit: String(limit),
  });
  if (data === null) return null;

  const played: PlayedTrack[] = [];

  for (const track of data.toptracks?.track ?? []) {
    const song = (track?.name ?? "").trim();
    const artist = (track?.artist?.name ?? "").trim();
    const durationSec = Number(track?.duration ?? 0);
    if (!song || !usableName(artist) || !durationSec) continue;

    played.push({
      artist,
      song,
      durationSec,
      playcount: Number(track?.playcount ?? 0) || 0,
    });
  }

  return played;
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
