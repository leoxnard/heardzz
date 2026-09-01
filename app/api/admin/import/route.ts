import { NextResponse } from "next/server";
import {
  checkTools, extractClip, nextCatalog, parseTimecode, readLibrary, resolveSource, slugify, upsertSolo,
} from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { resolveSoloist } from "@/lib/soloist";
import type { Credit, Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
// Downloading and re-encoding a track is not a two-second operation.
export const maxDuration = 300;

interface ImportBody {
  target: string;
  artist: string;
  song: string;
  /** Whoever takes the solo. Falls back to the artist when it is left out. */
  soloist?: string;
  /** Where the round starts. Omit or pass "opening" for the top of the tune. */
  solo?: string;
  album?: string;
  year?: string | number;
  note?: string;
  /** Carried over from the lookup so the credits are not fetched twice. */
  personnel?: Credit[];
  discogsReleaseId?: number;
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as ImportBody;

  const missing = (["target", "artist", "song"] as const).filter((key) => !body[key]?.trim());
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    await checkTools();

    const wantsOpening = !body.solo || body.solo === "opening";
    const soloStart = wantsOpening ? "opening" : parseTimecode(body.solo);
    const id = slugify(`${body.song}-${body.artist}`);

    const source = await resolveSource(body.target.trim());

    if (typeof soloStart === "number" && source.duration && soloStart > source.duration) {
      return NextResponse.json(
        {
          error:
            `That time is past the end of "${source.title}", which runs ` +
            `${Math.floor(source.duration / 60)}:${String(Math.floor(source.duration % 60)).padStart(2, "0")}.`,
        },
        { status: 400 },
      );
    }

    const clip = await extractClip({ youtubeId: source.youtubeId, soloStart, outputId: id });
    const library = await readLibrary();
    const existing = (library.solos as Solo[]).find((solo) => solo.id === id);

    const personnel = Array.isArray(body.personnel) ? body.personnel : [];
    const soloist = resolveSoloist(body.soloist, body.artist.trim(), personnel);

    const solo: Solo = {
      id,
      catalog: existing?.catalog ?? nextCatalog(library),
      artist: body.artist.trim(),
      song: body.song.trim(),
      album: body.album?.trim() || "",
      year: Number(body.year) || 0,
      personnel,
      ...soloist,
      discogsReleaseId: body.discogsReleaseId,
      youtubeId: source.youtubeId,
      soloStart: clip.soloStart,
      audio: clip.audio,
      leadIn: clip.leadIn,
      clipDuration: clip.clipDuration,
      sourceDuration: clip.sourceDuration,
      verified: wantsOpening,
      note: body.note?.trim() || undefined,
    };

    await upsertSolo(solo);
    return NextResponse.json({ solo, sourceTitle: source.title });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 },
    );
  }
}
