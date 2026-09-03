import { NextResponse } from "next/server";
import { cutFromSource, dropSource, searchCandidates } from "@/scripts/extract.mjs";
import { callerKey, take } from "@/lib/rate-limit";
import { ephemeralId, toSolo, type Cut } from "@/lib/ephemeral";
import { trackAlbum } from "@/lib/tidal";
import { albumFor } from "@/lib/lastfm";
import { pickBest, searchPhrase, type SearchHit } from "@/lib/tidal-youtube";
import type { Candidate } from "@/lib/tidal-candidates";

export const dynamic = "force-dynamic";
/** A download and a cut, for one record. */
export const maxDuration = 300;

/**
 * The one that costs something.
 *
 * Every call here is a download off YouTube and a pass of ffmpeg, run
 * because a stranger asked for it. Forty an hour is a long sitting and a
 * bounded amount of work; without a ceiling this endpoint is an open
 * invitation to spend somebody else's bandwidth.
 */
const ROUNDS = 40;
const ROUND_WINDOW_MS = 60 * 60 * 1000;

/**
 * Fetch one planned round and cut its opening.
 *
 * One per request, like the unattended playlist run: a sitting's worth of
 * downloads is far longer than any sensible request, and one at a time is
 * what lets the client keep three ahead while somebody plays the first.
 *
 * The whole recording is dropped as soon as the clip exists. It is only
 * needed to cut from, it is the largest thing on disk, and nothing here is
 * going to be marked up later.
 */
export async function POST(request: Request) {
  const limit = take(`foryou-fetch:${callerKey(request)}`, ROUNDS, ROUND_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `That is enough for now. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.` },
      { status: 429 },
    );
  }

  const body = (await request.json()) as { candidate?: Candidate };
  const candidate = body.candidate;

  if (!candidate?.song || !candidate.artist) {
    return NextResponse.json({ error: "A planned round is required" }, { status: 400 });
  }

  try {
    /*
     * Finding the upload happens here rather than in the plan, so a sitting
     * is limited by how long somebody keeps playing rather than by how many
     * were resolved before they started.
     *
     * A candidate that cannot be confirmed is reported as skipped, not as a
     * failure: the caller simply asks for the next one. Refusing is the
     * normal case for a fair few of these — the duration check turns down
     * live takes and covers, and that is the check doing its job.
     */
    let hits: SearchHit[] = [];
    try {
      hits = (await searchCandidates(searchPhrase(candidate), 5)) as SearchHit[];
    } catch {
      return NextResponse.json({ skipped: true, reason: "YouTube search failed" });
    }

    const { match, rejected } = pickBest(candidate, hits);
    if (!match) {
      return NextResponse.json({
        skipped: true,
        reason: rejected[0]?.reason ?? "nothing came back",
      });
    }
    const youtubeId = match.hit.youtubeId;

    const cut = (await cutFromSource({
      youtubeId,
      /*
       * Not "opening": that detector wants a level sustained near the
       * loudest part of the record, which on a compressed master skips the
       * intro and lands on the drop. These rounds are the top of the tune
       * or they are nothing.
       */
      start: "first-sound",
      outputId: ephemeralId(youtubeId, candidate.song),
    })) as Cut;

    await dropSource(youtubeId);

    /*
     * One extra call, next to a download that already took seconds. Failing
     * it costs the sleeve a line, not the round.
     *
     * Which service is asked depends on what built the candidate. A round
     * widened out of TIDAL carries a track id and TIDAL knows the album; a
     * round built off Last.fm carries no id at all, so that call had
     * nothing to ask about and the sleeve came back blank on every easy
     * round. Last.fm answers the same question from the artist and title
     * it does have.
     */
    let album: string | undefined;
    try {
      album = candidate.tidalTrackId
        ? (await trackAlbum(candidate.tidalTrackId))?.title
        : (await albumFor(candidate.artist, candidate.song)) ?? undefined;
    } catch {
      album = undefined;
    }

    return NextResponse.json({ solo: toSolo(candidate, youtubeId, cut, album) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not fetch that one" },
      { status: 500 },
    );
  }
}
