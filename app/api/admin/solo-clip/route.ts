import { NextResponse } from "next/server";
import { checkTools, extractClip, readLibrary, upsertSolo, parseTimecode } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cut the second clip: the one that opens on the solo instead of the tune.
 *
 * The head clip is forty seconds from the top and the solo is usually minutes
 * past it, so this is a fresh download and a fresh cut rather than a window
 * move. `soloAt` may be supplied to set the entry point at the same time.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as { id: string; soloAt?: string | number };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await checkTools();

    const library = await readLibrary();
    const solo = (library.solos as Solo[]).find((entry) => entry.id === body.id);
    if (!solo) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const soloAt = body.soloAt !== undefined ? parseTimecode(body.soloAt) : solo.soloAt;
    if (soloAt === undefined) {
      return NextResponse.json(
        { error: "This record has no solo entry time yet. Set one first." },
        { status: 400 },
      );
    }

    const clip = await extractClip({
      youtubeId: solo.youtubeId,
      soloStart: soloAt,
      outputId: `${solo.id}--solo`,
    });

    const updated: Solo = {
      ...solo,
      soloAt,
      soloClip: {
        audio: clip.audio,
        start: clip.soloStart,
        leadIn: clip.leadIn,
        clipDuration: clip.clipDuration,
      },
    };

    await upsertSolo(updated);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cut the solo clip" },
      { status: 500 },
    );
  }
}
