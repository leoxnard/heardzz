import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { mutateLibrary } from "@/scripts/extract.mjs";
import { stemFilesFor } from "@/scripts/separate.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { AUDIO_DIR } from "@/lib/paths";
import type { BulkAction, Solo } from "@/lib/types";

export const dynamic = "force-dynamic";

const ACTIONS: BulkAction[] = ["verify", "unverify", "disable", "enable", "delete"];

/** Verify, unverify, disable, enable or delete a whole selection at once. */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as { ids?: unknown; action?: BulkAction };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids is required" }, { status: 400 });
  }
  if (!body.action || !ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: "a valid action is required" }, { status: 400 });
  }

  const targets = new Set(ids);

  if (body.action === "delete") {
    const { removed, kept } = await mutateLibrary((library) => {
      const gone = library.solos.filter((solo) => targets.has(solo.id));
      const stays = library.solos.filter((solo) => !targets.has(solo.id));
      library.solos = stays;
      return { removed: gone, kept: stays };
    });

    // Same orphan-only rule as the single-record delete: a clip can be
    // shared by more than one entry (several soloists off one head clip),
    // so a file only goes once nothing left in the library still points at it.
    for (const target of removed) {
      for (const audio of [target.audio, target.soloClip?.audio]) {
        if (!audio) continue;
        if (kept.some((solo) => solo.audio === audio || solo.soloClip?.audio === audio)) continue;
        await unlink(path.join(AUDIO_DIR, path.basename(audio))).catch(() => {});
        for (const stem of await stemFilesFor(path.basename(audio, ".mp3"))) {
          await unlink(path.join(AUDIO_DIR, stem)).catch(() => {});
        }
      }
    }

    return NextResponse.json({ ok: true, removed: removed.map((solo) => solo.id) });
  }

  const patch: Partial<Solo> =
    body.action === "verify"
      ? { verified: true }
      : body.action === "unverify"
        ? { verified: false }
        : body.action === "disable"
          ? { disabled: true }
          : { disabled: false };

  const touched = await mutateLibrary((library) => {
    const out: Solo[] = [];
    library.solos = library.solos.map((solo) => {
      if (!targets.has(solo.id)) return solo;
      const next = { ...solo, ...patch };
      out.push(next);
      return next;
    });
    return out;
  });

  return NextResponse.json({ solos: touched });
}
