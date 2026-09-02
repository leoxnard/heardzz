import { NextResponse } from "next/server";
import { checkTools } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { sweep } from "@/lib/ephemeral";
import { parseTidalRef, tidalAvailable, tidalUnavailableReason } from "@/lib/tidal";
import { tasteFrom } from "@/lib/taste";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const denied = await requireAdmin();
  if (denied) return denied;

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
