import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { readLibrary, writeLibrary } from "@/scripts/extract.mjs";
import { stemFilesFor } from "@/scripts/separate.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { AUDIO_DIR } from "@/lib/paths";
import { resolveSoloist } from "@/lib/soloist";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const library = await readLibrary();
  return NextResponse.json(library);
}

/** Metadata, the solo entry point inside the clip, and the verified flag. */
export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as Partial<Solo> & { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const library = await readLibrary();
  const solos = library.solos as Solo[];
  const index = solos.findIndex((solo) => solo.id === body.id);
  if (index === -1) {
    return NextResponse.json({ error: `No solo with id ${body.id}` }, { status: 404 });
  }

  const current = solos[index];

  // Moving the marker inside the clip moves the source timestamp by the same
  // amount — they describe the same instant from two different origins.
  let soloStart = current.soloStart;
  if (typeof body.leadIn === "number") {
    const clamped = Math.max(0, Math.min(body.leadIn, current.clipDuration));
    soloStart = Math.max(0, current.soloStart + (clamped - current.leadIn));
    body.leadIn = Number(clamped.toFixed(3));
  }

  const merged = { ...current, ...body };

  /*
   * Moving an entry point moves the window the stems were judged over, so
   * the verdict stored on them no longer describes what a round would play.
   * The files are still valid audio, but "is there anything here at 0.5 s"
   * was answered about a different half second — and a stale yes deals a
   * silent round. Dropping them makes the next `npm run split-stems` redo
   * the measurement, which is the only way to get an honest answer back.
   */
  if (typeof body.leadIn === "number" && body.leadIn !== current.leadIn) {
    delete merged.stems;
  }
  if (
    merged.soloClip &&
    current.soloClip &&
    merged.soloClip.leadIn !== current.soloClip.leadIn
  ) {
    merged.soloClip = { ...merged.soloClip, stems: undefined };
  }

  const updated: Solo = {
    ...merged,
    id: current.id,
    soloStart: Number(soloStart.toFixed(3)),
    // Re-settled on every save, so the instrument follows the name and the
    // stored spelling always matches the one in the credits.
    ...resolveSoloist(merged.soloist, merged.artist, merged.personnel),
  };

  solos[index] = updated;
  await writeLibrary({ ...library, solos });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const library = await readLibrary();
  const solos = library.solos as Solo[];
  const target = solos.find((solo) => solo.id === id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await writeLibrary({ ...library, solos: solos.filter((solo) => solo.id !== id) });

  // Another entry may point at the same clip — a record with three soloists
  // shares one head clip — so only an orphan is removed. Clips live in the
  // data directory, and `audio` is the URL they are served under, so the file
  // has to be read back off the path rather than joined onto it.
  const kept = solos.filter((solo) => solo.id !== id);
  for (const audio of [target.audio, target.soloClip?.audio]) {
    if (!audio) continue;
    if (kept.some((solo) => solo.audio === audio || solo.soloClip?.audio === audio)) continue;
    await unlink(path.join(AUDIO_DIR, path.basename(audio))).catch(() => {});
    // The stems are named after the clip, so they orphan with it.
    for (const stem of stemFilesFor(path.basename(audio, ".mp3"))) {
      await unlink(path.join(AUDIO_DIR, stem)).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
