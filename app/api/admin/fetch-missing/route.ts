import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkTools, extractClip, readLibrary, upsertSolo, AUDIO_DIR } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Fetch one missing clip.
 *
 * The library file travels with the deploy; the audio it names does not, so
 * a fresh volume starts with seventeen records and nothing to play. One clip
 * per request rather than all of them: seventeen downloads is minutes of
 * work, longer than any sensible request timeout, and doing them one at a
 * time lets the screen show progress instead of hanging.
 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const library = await readLibrary();
  const missing = (library.solos as Solo[]).filter(
    (solo) => !existsSync(path.join(AUDIO_DIR, `${solo.id}.mp3`)),
  );

  if (missing.length === 0) {
    return NextResponse.json({ done: true, remaining: 0 });
  }

  try {
    await checkTools();
    const solo = missing[0];

    const clip = await extractClip({
      youtubeId: solo.youtubeId,
      soloStart: solo.soloStart ?? "opening",
      outputId: solo.id,
    });

    await upsertSolo({
      ...solo,
      audio: clip.audio,
      leadIn: clip.leadIn,
      clipDuration: clip.clipDuration,
      sourceDuration: clip.sourceDuration,
    });

    return NextResponse.json({
      done: missing.length === 1,
      remaining: missing.length - 1,
      fetched: `${solo.artist} — ${solo.song}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not fetch it",
        remaining: missing.length,
        failed: `${missing[0].artist} — ${missing[0].song}`,
      },
      { status: 500 },
    );
  }
}
