import { NextResponse } from "next/server";
import { lookupByRelease, lookupByTrack } from "@/scripts/discogs.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import type { Credit } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Fetch the band on a date, either from a release the user pointed at or by
 * searching for the tune. Returns credits without writing anything: the
 * library screen decides whether to keep them.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as {
    artist?: string;
    song?: string;
    discogs?: string;
  };

  try {
    const found = body.discogs?.trim()
      ? await lookupByRelease(body.discogs.trim(), body.song)
      : body.artist && body.song
        ? await lookupByTrack(body.artist, body.song)
        : null;

    if (!found) {
      return NextResponse.json(
        { error: "Discogs had nothing for that. Try pasting a release link." },
        { status: 404 },
      );
    }

    const personnel: Credit[] = found.personnel;
    return NextResponse.json({
      personnel,
      discogsReleaseId: found.id,
      title: found.title,
      // Discogs titles run "Artist - Album"; the artist half is already known.
      album: found.title.replace(/^.*?\s+-\s+/, "") || undefined,
      year: Number(found.year) || 0,
      suspect: found.suspect,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 500 },
    );
  }
}
