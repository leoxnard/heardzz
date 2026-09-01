import { NextResponse } from "next/server";
import {
  checkTools, extractClip, nextCatalog, parseTimecode, readLibrary, resolveSource, slugify, upsertSolo,
} from "@/scripts/extract.mjs";
import { blockedInProduction } from "@/lib/admin-guard";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
// Downloading and re-encoding a track is not a two-second operation.
export const maxDuration = 300;

interface ImportBody {
  target: string;
  artist: string;
  song: string;
  solo: string;
  soloist?: string;
  album?: string;
  year?: string | number;
  label?: string;
  note?: string;
}

export async function POST(request: Request) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

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

    const soloStart = parseTimecode(body.solo ?? 0);
    const id = slugify(`${body.song}-${body.artist}`);

    const source = await resolveSource(body.target.trim());

    if (source.duration && soloStart > source.duration) {
      return NextResponse.json(
        {
          error:
            `The solo time is past the end of "${source.title}", ` +
            `which runs ${Math.floor(source.duration / 60)}:${String(Math.floor(source.duration % 60)).padStart(2, "0")}.`,
        },
        { status: 400 },
      );
    }

    const clip = await extractClip({ youtubeId: source.youtubeId, soloStart, outputId: id });
    const library = await readLibrary();
    const existing = (library.solos as Solo[]).find((solo) => solo.id === id);

    const solo: Solo = {
      id,
      catalog: existing?.catalog ?? nextCatalog(library),
      artist: body.artist.trim(),
      song: body.song.trim(),
      soloist: body.soloist?.trim() || body.artist.trim(),
      album: body.album?.trim() || "",
      year: Number(body.year) || 0,
      label: body.label?.trim() || "",
      youtubeId: source.youtubeId,
      soloStart,
      audio: clip.audio,
      leadIn: clip.leadIn,
      clipDuration: clip.clipDuration,
      verified: false,
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
