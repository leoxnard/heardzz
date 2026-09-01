import { NextResponse } from "next/server";
import {
  applyClipToLibrary, checkTools, extractClip, missingAudioTargets, readLibrary,
} from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Fetch one missing clip file.
 *
 * The library file travels with the deploy; the audio it names does not, so
 * a fresh volume starts with every record and nothing to play. One file per
 * request rather than all of them: dozens of downloads is minutes of work,
 * longer than any sensible request timeout, and doing them one at a time
 * lets the screen show progress instead of hanging.
 *
 * "One file" and "one record" are not the same count — a record with three
 * soloists shares one head clip across three entries, so missing targets are
 * counted and fetched by file, and settle every entry that names one in a
 * single pass.
 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const library = await readLibrary();
  const missing = missingAudioTargets(library.solos as Solo[]);

  if (missing.length === 0) {
    return NextResponse.json({ done: true, remaining: 0 });
  }

  const target = missing[0];
  const named = (library.solos as Solo[]).find(
    (solo) => solo.youtubeId === target.youtubeId,
  );

  try {
    await checkTools();

    const clip = await extractClip({
      youtubeId: target.youtubeId,
      soloStart: target.start,
      outputId: target.outputId,
    });
    await applyClipToLibrary(target.outputId, clip);

    return NextResponse.json({
      done: missing.length === 1,
      remaining: missing.length - 1,
      fetched: named ? `${named.artist} — ${named.song}` : target.outputId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not fetch it",
        remaining: missing.length,
        failed: named ? `${named.artist} — ${named.song}` : target.outputId,
      },
      { status: 500 },
    );
  }
}
