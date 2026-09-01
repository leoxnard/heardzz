import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import {
  checkTools, cutFromSource, dropSource, nextCatalog, readLibrary, slugify, writeLibrary,
} from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { AUDIO_DIR } from "@/lib/paths";
import { resolveSoloist } from "@/lib/soloist";
import type { Credit, MarkedSolo, Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
/** Cutting is local, but a batch of six solos is still not instant. */
export const maxDuration = 300;

interface PublishBody {
  youtubeId: string;
  artist: string;
  song: string;
  album?: string;
  year?: number;
  note?: string;
  personnel?: Credit[];
  discogsReleaseId?: number;
  /** Where the tune itself begins. Every entry's round opens here. */
  start: number;
  solos: MarkedSolo[];
  /** Entries this replaces — anything not re-marked is dropped. */
  replaces?: string[];
  /** Keep the recording on disk, for a session that is not finished with it. */
  keepSource?: boolean;
}

/** Filenames are slugs; the stored path is a URL. Read one off the other. */
function clipFile(audio: string): string {
  return path.join(AUDIO_DIR, path.basename(audio));
}

/**
 * Turn a marked-up recording into library entries.
 *
 * Everything up to here happened against the whole tune, on disk. This is the
 * moment it becomes clips: one for the head, one per solo, all cut locally out
 * of the file that is already there — and then the recording is thrown away.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as PublishBody;

  if (!body.youtubeId || !body.artist?.trim() || !body.song?.trim()) {
    return NextResponse.json(
      { error: "A recording, an artist and a song are all needed" },
      { status: 400 },
    );
  }

  try {
    await checkTools();

    const artist = body.artist.trim();
    const song = body.song.trim();
    const personnel = Array.isArray(body.personnel) ? body.personnel : [];
    const base = slugify(`${song}-${artist}`);
    const marks: MarkedSolo[] = Array.isArray(body.solos) ? body.solos : [];

    const library = await readLibrary();
    const solos = library.solos as Solo[];
    const replaces = new Set(body.replaces ?? []);

    // The head is one clip however many people solo on the record, so it is
    // cut once and every entry points at the same file.
    const head = await cutFromSource({
      youtubeId: body.youtubeId,
      start: Math.max(0, body.start),
      outputId: base,
    });

    // An entry per solo — and, when nobody solos, one for the tune itself, so
    // a record can be added in the time it takes to find the downbeat.
    const wanted: MarkedSolo[] = marks.length > 0
      ? marks
      : [{ at: head.soloStart, soloist: artist }];

    const taken = new Set(
      solos.filter((solo) => !replaces.has(solo.id)).map((solo) => solo.id),
    );
    const written: Solo[] = [];
    let catalogPool = { ...library, solos: [...solos] };

    for (const [index, mark] of wanted.entries()) {
      const soloist = resolveSoloist(mark.soloist, artist, personnel);

      let id = mark.id ?? (index === 0
        ? base
        : `${base}-${slugify(soloist.soloist) || String(index + 1)}`);
      // Two tenor players called the same thing is not a case worth naming.
      for (let n = 2; taken.has(id) && !replaces.has(id); n++) id = `${base}-${n}`;
      taken.add(id);

      const hasSolo = marks.length > 0;
      const soloClip = hasSolo
        ? await cutFromSource({
            youtubeId: body.youtubeId,
            start: Math.max(0, mark.at),
            outputId: `${id}--solo`,
          })
        : null;

      const existing = solos.find((solo) => solo.id === id);

      const solo: Solo = {
        id,
        catalog: existing?.catalog ?? nextCatalog(catalogPool),
        artist,
        song,
        album: body.album?.trim() ?? existing?.album ?? "",
        year: Number(body.year) || existing?.year || 0,
        personnel,
        ...soloist,
        discogsReleaseId: body.discogsReleaseId,
        youtubeId: body.youtubeId,
        soloStart: head.soloStart,
        audio: head.audio,
        leadIn: head.leadIn,
        clipDuration: head.clipDuration,
        sourceDuration: head.sourceDuration,
        soloAt: soloClip ? soloClip.soloStart : undefined,
        soloClip: soloClip
          ? {
              audio: soloClip.audio,
              start: soloClip.soloStart,
              leadIn: soloClip.leadIn,
              clipDuration: soloClip.clipDuration,
            }
          : undefined,
        // Both markers were put there by a person looking at the waveform.
        verified: true,
        note: mark.note?.trim() || body.note?.trim() || undefined,
      };

      written.push(solo);
      catalogPool = { ...catalogPool, solos: [...catalogPool.solos, solo] };
    }

    const writtenIds = new Set(written.map((solo) => solo.id));
    const dropped = solos.filter(
      (solo) => replaces.has(solo.id) && !writtenIds.has(solo.id),
    );

    const next = [
      ...solos.filter((solo) => !writtenIds.has(solo.id) && !replaces.has(solo.id)),
      ...written,
    ];
    await writeLibrary({ ...library, solos: next });

    // A dropped entry's clip may still belong to one that stayed.
    for (const solo of dropped) {
      for (const audio of [solo.audio, solo.soloClip?.audio]) {
        if (!audio) continue;
        if (next.some((kept) => kept.audio === audio || kept.soloClip?.audio === audio)) continue;
        await unlink(clipFile(audio)).catch(() => {});
      }
    }

    if (!body.keepSource) await dropSource(body.youtubeId);

    return NextResponse.json({ solos: written, removed: dropped.map((solo) => solo.id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cut the clips" },
      { status: 500 },
    );
  }
}
