import { NextResponse } from "next/server";
import { checkTools } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { DuplicateRecord, publishRecord, type PublishInput } from "@/lib/publish";

export const dynamic = "force-dynamic";
/** Cutting is local, but a batch of six solos is still not instant. */
export const maxDuration = 300;

/**
 * Turn a marked-up recording into library entries.
 *
 * The work itself is in lib/publish.ts, because the automatic playlist
 * fetch does the same thing without anybody at the screen. This is the door
 * a person comes through: it checks the request and translates a refusal
 * into a status code.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as PublishInput;

  if (!body.youtubeId || !body.artist?.trim() || !body.song?.trim()) {
    return NextResponse.json(
      { error: "A recording, an artist and a song are all needed" },
      { status: 400 },
    );
  }

  try {
    await checkTools();
    const { solos, removed } = await publishRecord(body);
    return NextResponse.json({ solos, removed });
  } catch (error) {
    if (error instanceof DuplicateRecord) {
      return NextResponse.json(
        { error: error.message, duplicates: error.duplicates },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cut the clips" },
      { status: 500 },
    );
  }
}
