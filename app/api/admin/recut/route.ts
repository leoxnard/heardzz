import { NextResponse } from "next/server";
import { checkTools, extractClip, readLibrary, upsertSolo, parseTimecode } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Re-cut around a new point in the source. Needed only when the solo is not
 * inside the existing clip at all — anything within the clip is a marker move,
 * which costs nothing.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as { id: string; soloStart: string | number };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await checkTools();

    const library = await readLibrary();
    const solo = (library.solos as Solo[]).find((entry) => entry.id === body.id);
    if (!solo) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const soloStart = parseTimecode(body.soloStart);
    const clip = await extractClip({
      youtubeId: solo.youtubeId,
      soloStart,
      outputId: solo.id,
    });

    const updated: Solo = {
      ...solo,
      soloStart,
      audio: clip.audio,
      leadIn: clip.leadIn,
      clipDuration: clip.clipDuration,
      verified: false,
    };

    await upsertSolo(updated);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Re-cut failed" },
      { status: 500 },
    );
  }
}
