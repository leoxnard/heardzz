import { NextResponse } from "next/server";
import { callerKey, take } from "@/lib/rate-limit";
import { tidalAvailable, tidalUnavailableReason } from "@/lib/tidal";
import { lastfmAvailable, lastfmUnavailableReason, parseLastfmUser, topArtists } from "@/lib/lastfm";
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
 * How many of somebody's most-played artists to ask Last.fm for.
 *
 * Longer than the number actually used, deliberately. Only `SEEDS` of them
 * are ever placed against TIDAL — the rest are depth, there for when the
 * top of the list will not resolve, which is common enough for anybody
 * whose favourite act is obscure or spelled unusually.
 */
const NAMES = 20;

/**
 * Seeds a round is built from — the same handful `/api/foryou/from-text`
 * settles on. More is not a richer round: everything past this point
 * widens each seed to its neighbours anyway, so a seventh favourite
 * mostly buys another TIDAL crawl.
 */
const SEEDS = 6;

/**
 * Read a taste out of somebody's listening rather than out of a link.
 *
 * The most honest of the three doors and the least work to walk through —
 * a username is a thing people know by heart, where a playlist link has to
 * be found and copied. What it hands over is names, so from here it is
 * exactly `/api/foryou/from-text`: the names are placed against TIDAL
 * through MusicBrainz (`lib/taste-text.ts`), and the round is widened and
 * built by the same code a pasted link uses.
 *
 * Nothing here downloads and nothing here touches the library.
 */
export async function POST(request: Request) {
  if (!lastfmAvailable()) {
    return NextResponse.json({ error: lastfmUnavailableReason() }, { status: 400 });
  }
  if (!tidalAvailable()) {
    return NextResponse.json({ error: tidalUnavailableReason() }, { status: 400 });
  }

  const body = (await request.json()) as { user?: string };
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
    const names = await topArtists(user, NAMES);
    if (names === null) {
      return NextResponse.json(
        { error: `Last.fm has no listener called ${user}.` },
        { status: 400 },
      );
    }
    if (names.length === 0) {
      return NextResponse.json(
        { error: `${user} has not scrobbled anything yet.` },
        { status: 400 },
      );
    }

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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that" },
      { status: 500 },
    );
  }
}
