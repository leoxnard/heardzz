import { NextResponse } from "next/server";
import { checkTools, resolvePlaylist } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Enough for an album side and a half; nobody marks up more in one sitting. */
const LIMIT = 30;

/**
 * List a playlist without fetching any of it.
 *
 * The queue this feeds is marked one record at a time — the download for each
 * happens when its turn comes, so quitting halfway costs nothing.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as { target?: string };
  if (!body.target?.trim()) {
    return NextResponse.json({ error: "Paste a playlist link first" }, { status: 400 });
  }

  try {
    await checkTools();
    const entries = await resolvePlaylist(body.target.trim(), LIMIT);
    if (entries.length === 0) {
      return NextResponse.json({ error: "That playlist has nothing playable in it" }, { status: 400 });
    }
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that playlist" },
      { status: 500 },
    );
  }
}
