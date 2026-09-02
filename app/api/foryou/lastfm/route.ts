import { NextResponse } from "next/server";
import { callerKey, take } from "@/lib/rate-limit";
import { tidalAvailable, tidalUnavailableReason } from "@/lib/tidal";
import {
  lastfmAvailable,
  lastfmUnavailableReason,
  parseLastfmUser,
  topArtists,
  topTracks,
} from "@/lib/lastfm";
import { candidatesFromPlayed } from "@/lib/lastfm-candidates";
import { resolveArtistNames } from "@/lib/taste-text";
import { tasteFromArtistIds } from "@/lib/taste";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The same door, held to the same width as the other two: reading a taste
 * is cheap on its own, but it is what a sitting's downloads are spent
 * against.
 */
const READS = 8;
const READ_WINDOW_MS = 60 * 60 * 1000;

/**
 * How many of somebody's most-played artists to ask for, in the widened
 * round.
 *
 * Longer than the number actually used, deliberately. Only `SEEDS` of them
 * are ever placed against TIDAL — the rest are depth, there for when the
 * top of the list will not resolve, which is common enough for anybody
 * whose favourite act is obscure or spelled unusually.
 */
const NAMES = 20;

/**
 * Seeds a widened round is built from — the same handful
 * `/api/foryou/from-text` settles on. More is not a richer round:
 * everything past this point widens each seed to its neighbours anyway, so
 * a seventh favourite mostly buys another TIDAL crawl.
 */
const SEEDS = 6;

/**
 * Tunes to read for the easy round.
 *
 * Far more than a sitting can get through — the fetch is capped at forty
 * downloads an hour — and that is the point. This one call is the entire
 * supply, so there is nothing to ask again for later, which is why the
 * response below turns replanning off.
 */
const PLAYED = 200;

/**
 * Read a taste out of somebody's listening rather than out of a link, at
 * one of two difficulties.
 *
 * "known" plays the records they have actually played. Every tune is one
 * their own history says they have heard, most of them many times, so the
 * round is winnable by construction — and it is the quick one, because a
 * scrobble already carries the length the fetch needs and so never touches
 * MusicBrainz or TIDAL at all.
 *
 * "wider" is the harder game and the original one: the history is read
 * only for *who* they like, that set is widened along TIDAL's
 * similar-artist edges, and the tunes come from the widened set. Near
 * enough to be fair, far enough to be worth guessing — and the same
 * bargain `/api/foryou/plan` strikes with a pasted playlist.
 *
 * Nothing here downloads and nothing here touches the library.
 */
export async function POST(request: Request) {
  if (!lastfmAvailable()) {
    return NextResponse.json({ error: lastfmUnavailableReason() }, { status: 400 });
  }

  const body = (await request.json()) as { user?: string; mode?: string };
  const known = body.mode === "known";

  /*
   * Only the widened round needs TIDAL. Refusing the easy one for a
   * credential it never reads would be a lie, and the easy one is exactly
   * what somebody without TIDAL set up should still be able to play.
   */
  if (!known && !tidalAvailable()) {
    return NextResponse.json({ error: tidalUnavailableReason() }, { status: 400 });
  }

  const user = parseLastfmUser(body.user ?? "");
  if (!user) {
    return NextResponse.json(
      { error: "Give a Last.fm username, or paste your profile link." },
      { status: 400 },
    );
  }

  /*
   * Counted only once the name is known to be shaped like a name — the
   * same reasoning as `/api/foryou/plan`. Spending one of somebody's few
   * sittings on a typo is a mean way to meet them.
   */
  const limit = take(`foryou-lastfm:${callerKey(request)}`, READS, READ_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many sittings. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.` },
      { status: 429 },
    );
  }

  try {
    return known ? await fromPlayed(user) : await fromWidenedTaste(user);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that" },
      { status: 500 },
    );
  }
}

/** The easy round: the records they have played, and nothing else. */
async function fromPlayed(user: string) {
  const played = await topTracks(user, PLAYED);
  if (played === null) return missing(user);
  if (played.length === 0) return silent(user);

  const { candidates } = await candidatesFromPlayed(played);
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "Everything you play is already in the library here." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    source: `${user}'s own records`,
    /*
     * The artists are named rather than "reached": nothing was widened to,
     * so calling it a reach would overstate what happened. Bounded, because
     * a long history names more acts than a line can hold.
     */
    reached: Array.from(new Set(candidates.map((c) => c.artist))).slice(0, 12),
    candidates,
    /*
     * The username, only so the sitting has something to be saved under —
     * `persistSession` treats a blank target as nothing worth resuming.
     * It is never asked against, which is what `replan: false` says.
     */
    target: user,
    /*
     * One read was the whole supply: two hundred tunes against a fetch
     * capped at forty an hour. Asking again would only re-read the same
     * history, and asking `/api/foryou/plan` — which is where a replan
     * goes — a username it cannot parse would spend a sitting on a 400.
     */
    replan: false,
  });
}

/** The hard round: their taste, widened to artists they did not name. */
async function fromWidenedTaste(user: string) {
  const names = await topArtists(user, NAMES);
  if (names === null) return missing(user);
  if (names.length === 0) return silent(user);

  const resolved = await resolveArtistNames(names, SEEDS);
  if (resolved.length === 0) {
    return NextResponse.json(
      { error: "TIDAL doesn't have anyone you listen to." },
      { status: 400 },
    );
  }

  const source = `${user} on Last.fm`;
  const result = await tasteFromArtistIds(resolved.map((a) => a.id), source);
  if (result.candidates.length === 0) {
    return NextResponse.json(
      { error: "Nothing well enough known came out of that taste." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    source,
    reached: result.reached,
    candidates: result.candidates,
    /*
     * Stands in for the pasted link a replan would otherwise carry, the
     * same way `/api/foryou/from-text` does it — the ids are sent back
     * rather than the username so a replan re-widens the taste already
     * read, instead of paying MusicBrainz for the same names again.
     */
    target: resolved.map((a) => a.id).join(","),
  });
}

function missing(user: string) {
  return NextResponse.json({ error: `Last.fm has no listener called ${user}.` }, { status: 400 });
}

function silent(user: string) {
  return NextResponse.json({ error: `${user} has not scrobbled anything yet.` }, { status: 400 });
}
