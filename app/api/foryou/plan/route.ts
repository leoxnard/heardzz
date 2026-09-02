import { NextResponse } from "next/server";
import { checkTools } from "@/scripts/extract.mjs";
import { callerKey, take } from "@/lib/rate-limit";
import { sweep } from "@/lib/ephemeral";
import { parseTidalRef, tidalAvailable, tidalUnavailableReason } from "@/lib/tidal";
import { tasteFrom } from "@/lib/taste";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reading a taste is cheap — TIDAL only — but it is the door to the fetching
 * below, so it is held to a few sittings an hour rather than left open.
 */
const PLANS = 8;
const PLAN_WINDOW_MS = 60 * 60 * 1000;

/**
 * Read a taste and hand back a long list of records to try.
 *
 * Deliberately does no YouTube work at all. It used to resolve each tune to
 * an upload here, which made this the slow half of the request and capped a
 * sitting at however many were resolved up front — the reason a sitting ran
 * out after six. Resolving moved into the fetch, so this is TIDAL only, it
 * answers in seconds, and it answers with far more than anyone will play.
 *
 * Nothing here downloads and nothing here touches the library.
 */
export async function POST(request: Request) {
  if (!tidalAvailable()) {
    return NextResponse.json({ error: tidalUnavailableReason() }, { status: 400 });
  }

  const body = (await request.json()) as { target?: string };
  const ref = parseTidalRef(body.target ?? "");
  if (!ref) {
    return NextResponse.json(
      { error: "Paste a TIDAL playlist, artist or track link." },
      { status: 400 },
    );
  }

  /*
   * Counted only once the link is known to be a link. A mistyped address
   * costs nothing to refuse, and spending one of somebody's few sittings on
   * a typo is a mean way to meet them.
   */
  const limit = take(`foryou-plan:${callerKey(request)}`, PLANS, PLAN_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many sittings. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.` },
      { status: 429 },
    );
  }

  try {
    await checkTools();
    void sweep();

    const taste = await tasteFrom(ref);
    if (taste.candidates.length === 0) {
      return NextResponse.json(
        {
          error:
            ref.kind === "playlist"
              ? "Nothing well enough known came out of that playlist. Is it public?"
              : "TIDAL lists nothing well enough known for that.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      source: taste.source,
      reached: taste.reached,
      candidates: taste.candidates,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that" },
      { status: 500 },
    );
  }
}
