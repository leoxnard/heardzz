import { NextResponse } from "next/server";
import { checkTools, resolvePlaylist } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { findDuplicates, loadSolos } from "@/lib/library";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * A ceiling, not a target. `--flat-playlist` costs one request whatever the
 * count, so there is no reason to stop at an evening's worth — the reason to
 * stop at all is that a playlist is technically unbounded and this is a
 * marking queue, not an archive importer.
 */
const LIMIT = 300;

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
    const all = await resolvePlaylist(body.target.trim(), LIMIT);
    if (all.length === 0) {
      return NextResponse.json({ error: "That playlist has nothing playable in it" }, { status: 400 });
    }

    // A playlist is usually run more than once, and the half of it already in
    // the library is not worth fetching again to be refused at the end.
    const solos = await loadSolos();
    const entries = all.filter(
      (entry) => findDuplicates(solos, { youtubeId: entry.youtubeId }).length === 0,
    );

    return NextResponse.json({
      entries,
      known: all.length - entries.length,
      // Asking for LIMIT and getting exactly LIMIT back means there was
      // more to read; --playlist-end has no way to say so directly.
      truncated: all.length === LIMIT,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that playlist" },
      { status: 500 },
    );
  }
}
