import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { mutateLibrary, readLibrary } from "@/scripts/extract.mjs";
import { stemFilesFor } from "@/scripts/separate.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { AUDIO_DIR } from "@/lib/paths";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const library = await readLibrary();
  return NextResponse.json(library);
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const target = await mutateLibrary((library) => {
    const found = library.solos.find((solo) => solo.id === id);
    if (!found) return false;
    library.solos = library.solos.filter((solo) => solo.id !== id);
    return found;
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const solos = (await readLibrary()).solos as Solo[];
  // Another entry may point at the same clip — a record with three soloists
  // shares one head clip — so only an orphan is removed. Clips live in the
  // data directory, and `audio` is the URL they are served under, so the file
  // has to be read back off the path rather than joined onto it.
  const kept = solos;
  for (const audio of [target.audio, target.soloClip?.audio]) {
    if (!audio) continue;
    if (kept.some((solo) => solo.audio === audio || solo.soloClip?.audio === audio)) continue;
    await unlink(path.join(AUDIO_DIR, path.basename(audio))).catch(() => {});
    // The stems are named after the clip, so they orphan with it.
    for (const stem of await stemFilesFor(path.basename(audio, ".mp3"))) {
      await unlink(path.join(AUDIO_DIR, stem)).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
