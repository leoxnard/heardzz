import { NextResponse } from "next/server";
import {
  checkTools, extractClip, nextCatalog, readLibrary, slugify, upsertSolo,
} from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { resolveSoloist } from "@/lib/soloist";
import { readSuggestions, updateSuggestion } from "@/lib/suggestions";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";
/** Confirming means downloading and re-encoding, which is not quick. */
export const maxDuration = 300;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const store = await readSuggestions();
  return NextResponse.json(store);
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as {
    id?: string;
    action?: "approve" | "reject";
    /**
     * The clips already exist — the reviewer marked the record up by hand
     * rather than taking the opening on trust. Nothing is downloaded.
     */
    alreadyCut?: boolean;
    reason?: string;
    /** Corrections the reviewer made before confirming. */
    solo?: Partial<Solo>;
  };

  if (!body.id || !body.action) {
    return NextResponse.json({ error: "id and action are required" }, { status: 400 });
  }

  const { suggestions } = await readSuggestions();
  const suggestion = suggestions.find((s) => s.id === body.id);
  if (!suggestion) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.action === "reject") {
    const updated = await updateSuggestion(body.id, {
      status: "rejected",
      reason: body.reason?.slice(0, 400),
    });
    return NextResponse.json({ suggestion: updated });
  }

  if (body.alreadyCut) {
    const updated = await updateSuggestion(body.id, { status: "approved" });
    return NextResponse.json({ suggestion: updated });
  }

  try {
    await checkTools();

    const merged = { ...suggestion, ...body.solo };
    const id = slugify(`${merged.song}-${merged.artist}`);

    // The download happens here, behind the password, and not a moment earlier.
    const clip = await extractClip({
      youtubeId: suggestion.youtubeId,
      soloStart: "opening",
      outputId: id,
    });

    const library = await readLibrary();
    const existing = (library.solos as Solo[]).find((solo) => solo.id === id);

    const personnel = merged.personnel ?? [];
    const soloist = resolveSoloist(merged.soloist, merged.artist, personnel);

    const solo: Solo = {
      id,
      catalog: existing?.catalog ?? nextCatalog(library),
      artist: merged.artist,
      song: merged.song,
      album: merged.album ?? "",
      year: Number(merged.year) || 0,
      personnel,
      ...soloist,
      discogsReleaseId: merged.discogsReleaseId,
      youtubeId: suggestion.youtubeId,
      soloStart: clip.soloStart,
      audio: clip.audio,
      leadIn: clip.leadIn,
      clipDuration: clip.clipDuration,
      sourceDuration: clip.sourceDuration,
      verified: true,
      note: merged.note || undefined,
    };

    await upsertSolo(solo);
    const updated = await updateSuggestion(body.id, { status: "approved" });

    return NextResponse.json({ solo, suggestion: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add it" },
      { status: 500 },
    );
  }
}
