import { NextResponse } from "next/server";
import {
  checkTools, dropSource, fetchSource, listSources, resolveSource,
} from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { inspectSource, type InspectResult } from "@/lib/inspect";
import { findDuplicates, loadSolos } from "@/lib/library";

export const dynamic = "force-dynamic";
/** Fetching a whole recording is a download, not a request. */
export const maxDuration = 300;

/** An entry this recording would duplicate, named so the screen can say so. */
export interface DuplicateEntry {
  id: string;
  artist: string;
  song: string;
  soloist: string;
}

export interface SourceResult extends InspectResult {
  /** What the browser plays and draws while the solos are being marked. */
  previewUrl: string;
  /** Length of the recording as it is on disk, which is the one that counts. */
  duration: number;
  /** Where the music starts — the opening marker, placed for you. */
  audibleStart: number;
  /**
   * Entries this record already has. Empty nearly always; when it is not,
   * the screen says so before a minute is spent marking something twice.
   */
  duplicates: DuplicateEntry[];
}

/**
 * Hold a whole recording open.
 *
 * This is the first step of adding anything now: the tune is downloaded once
 * and kept, so every position is marked against the whole thing and the clips
 * are cut at the end, out of what is already on disk.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as {
    target?: string;
    youtubeId?: string;
    discogs?: string;
  };

  const target = body.target?.trim() || (body.youtubeId
    ? `https://www.youtube.com/watch?v=${body.youtubeId}`
    : "");
  if (!target) {
    return NextResponse.json({ error: "Paste a YouTube link first" }, { status: 400 });
  }

  try {
    await checkTools();
    const source = await resolveSource(target);

    // The credits lookup talks to Discogs while yt-dlp is still pulling bytes;
    // there is no reason for either to wait on the other.
    const [held, inspected] = await Promise.all([
      fetchSource({ youtubeId: source.youtubeId }),
      inspectSource(source, body.discogs),
    ]);

    const duplicates = findDuplicates(await loadSolos(), {
      youtubeId: source.youtubeId,
      artist: inspected.artist,
      song: inspected.song,
    });

    const result: SourceResult = {
      ...inspected,
      duplicates: duplicates.map((solo) => ({
        id: solo.id,
        artist: solo.artist,
        song: solo.song,
        soloist: solo.soloist,
      })),
      previewUrl: held.previewUrl,
      duration: held.duration || inspected.sourceDuration,
      audibleStart: held.audibleStart,
    };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not fetch that recording" },
      { status: 500 },
    );
  }
}

/** What is still being held. Abandoned marking sessions, mostly. */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({ sources: await listSources() });
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await dropSource(id);
  return NextResponse.json({ ok: true });
}
