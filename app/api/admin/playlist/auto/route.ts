import { NextResponse } from "next/server";
import { checkTools, resolveSource } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { cleanName } from "@/lib/clean";
import { findDuplicates } from "@/lib/duplicates";
import { inspectSource } from "@/lib/inspect";
import { loadSolos } from "@/lib/library";
import { DuplicateRecord, publishRecord } from "@/lib/publish";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
/** A download, a Discogs lookup and a cut. Not a request-shaped amount of work. */
export const maxDuration = 300;

/**
 * Add one record from a playlist without anybody marking it up.
 *
 * The manual path exists because a person hearing the record is the only
 * way to know where the solo enters. This path gives that up deliberately:
 * it takes the opening and nothing else, cuts one clip, and writes the
 * entry **unverified** — so a playlist of forty becomes forty rows in the
 * unverified list, each one playable, each one waiting for somebody to
 * listen to the clip and confirm it.
 *
 * One record per request, like fetching missing clips: forty downloads is
 * far longer than any sensible request, and one at a time is what lets the
 * screen count down instead of hanging.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as { youtubeId?: string };
  const youtubeId = body.youtubeId?.trim();
  if (!youtubeId) {
    return NextResponse.json({ error: "A video id is required" }, { status: 400 });
  }

  try {
    await checkTools();
    const source = await resolveSource(`https://www.youtube.com/watch?v=${youtubeId}`);
    const inspected = await inspectSource(source);

    const artist = cleanName(inspected.artist);
    const song = cleanName(inspected.song);
    if (!artist || !song) {
      return NextResponse.json({
        status: "skipped",
        reason: "Nothing in that upload said who it is or what the tune is.",
        title: source.title,
      });
    }

    // Checked here as well as inside publishRecord so a playlist run reports
    // "already here" as a result rather than as a failure.
    const known = findDuplicates(await loadSolos(), { youtubeId, artist, song });
    if (known.length > 0) {
      return NextResponse.json({
        status: "duplicate",
        artist,
        song,
        existing: known.map((solo: Solo) => solo.id),
      });
    }

    const { solos } = await publishRecord({
      youtubeId,
      artist,
      song,
      album: inspected.album,
      year: inspected.year,
      personnel: inspected.personnel,
      discogsReleaseId: inspected.discogsReleaseId,
      // No solos are marked, so there is only the head clip, and the start
      // is wherever the onset detector heard the music begin.
      start: "opening",
      solos: [],
      verified: false,
    });

    return NextResponse.json({
      status: "added",
      artist,
      song,
      solo: solos[0],
      // Carried through so a doubtful Discogs match is visible in the run
      // rather than only in the entry it wrote.
      billing: inspected.billing,
      notes: inspected.notes,
    });
  } catch (error) {
    if (error instanceof DuplicateRecord) {
      return NextResponse.json({ status: "duplicate", existing: error.duplicates });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add that one" },
      { status: 500 },
    );
  }
}
