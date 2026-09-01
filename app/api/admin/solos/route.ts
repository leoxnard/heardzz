import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { readLibrary, writeLibrary } from "@/scripts/extract.mjs";
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
  }

  return NextResponse.json({ ok: true });
}
