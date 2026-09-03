import { NextResponse } from "next/server";
import { callerKey, take } from "@/lib/rate-limit";
import { lastfmAvailable, lastfmUnavailableReason, tagTracks } from "@/lib/lastfm";
import { candidatesFromTracks } from "@/lib/lastfm-candidates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Held to the same width as every other way in. */
const READS = 8;
const READ_WINDOW_MS = 60 * 60 * 1000;

/** Plenty: the fetch is capped at forty an hour, so this is the whole supply. */
const TRACKS = 200;

/**
 * A round out of a genre, and nothing else.
 *
 * The other route through a typed style — `/api/foryou/from-text` — hands
 * the words to a model, asks it to name artists known for them, then
 * places each name against TIDAL through MusicBrainz. That is the right
 * machinery for "Michael Brecker only, but not the fusion", and it is a
 * great deal of machinery for the word "bebop".
 *
 * Last.fm already knows what a tag is best known for, and answers with
 * tunes that state their own length. So a genre that is genuinely just a
 * genre comes back in about a second, with no model in the loop and
 * nothing to resolve — and the records are the ones most listened to under
 * that tag, which is exactly what makes them nameable.
 *
 * A tag nobody uses is not an error here, it is an empty list. That is the
 * signal to send somebody to the other door rather than to fail at them.
 */
export async function POST(request: Request) {
  if (!lastfmAvailable()) {
    return NextResponse.json({ error: lastfmUnavailableReason() }, { status: 400 });
  }

  const body = (await request.json()) as { tag?: string };
  /*
   * Only the length is checked. A tag is whatever people have typed on
   * Last.fm — "hard bop", "jazz fusion", "80s" — so there is no shape to
   * insist on, and the request is built with URLSearchParams against a
   * hardcoded host either way.
   */
  const tag = (body.tag ?? "").trim().slice(0, 60);
  if (!tag) {
    return NextResponse.json({ error: "Name a genre." }, { status: 400 });
  }

  const limit = take(`foryou-tag:${callerKey(request)}`, READS, READ_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many sittings. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.` },
      { status: 429 },
    );
  }

  try {
    const tracks = await tagTracks(tag, TRACKS);
    if (tracks.length === 0) {
      return NextResponse.json(
        { error: `Last.fm has nothing tagged "${tag}". Try describing it instead.` },
        { status: 400 },
      );
    }

    const { candidates } = await candidatesFromTracks(tracks);
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: `Everything tagged "${tag}" is already in the library here.` },
        { status: 400 },
      );
    }

    return NextResponse.json({
      source: tag,
      reached: Array.from(new Set(candidates.map((c) => c.artist))).slice(0, 12),
      candidates,
      /*
       * The tag itself, so the sitting has something to be saved under.
       * Never asked against — one read was the whole supply.
       */
      target: tag,
      replan: false,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that" },
      { status: 500 },
    );
  }
}
