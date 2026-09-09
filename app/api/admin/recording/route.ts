import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { mutateLibrary } from "@/scripts/extract.mjs";
import { AUDIO_DIR } from "@/lib/paths";
import { splitShapeFor } from "@/scripts/separate.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { resolveSoloist } from "@/lib/soloist";
import type { Solo } from "@/lib/types";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------
   Saving a recording rather than an entry.

   A tune with three soloists on it is three entries in the library, and
   almost everything about them is one thing said three times: the same
   personnel, the same album, the same head clip pulled apart the same way.
   Only the solo differs — who, where, and the cut taken from it.

   Saving them one at a time meant that shared half could drift. Correct the
   credits on the entry you happen to have open and the other two keep the
   old ones, which is not only wrong twice over but changes what a rhythm
   section consists of on two of the three. So the screen edits the
   recording, and this writes it: shared fields onto every entry, solo
   fields onto the entry they belong to, in one pass over the library.
   ------------------------------------------------------------------ */

/**
 * What belongs to the recording rather than to one solo on it.
 *
 * The head clip and its geometry are in here because there is one head clip
 * — the entries name the same file — and its stems with it, for the same
 * reason. `melody` too: the theme is stated once, whoever is being asked
 * about.
 */
const SHARED = [
  "artist", "song", "album", "year", "note", "personnel", "melody",
  "youtubeId", "audio", "leadIn", "clipDuration", "soloStart", "disabled",
  "discogsReleaseId",
] as const;

/** And what belongs to the entry: id, catalog, the soloist, and their cut. */
const OWN = ["soloist", "soloAt", "soloClip", "verified"] as const;

type Incoming = Pick<Solo, (typeof SHARED)[number]> & {
  entries: (Pick<Solo, (typeof OWN)[number]> & { id: string })[];
};

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as Partial<Incoming>;
  const entries = body.entries ?? [];
  if (entries.length === 0) {
    return NextResponse.json({ error: "entries are required" }, { status: 400 });
  }

  const dropped: string[] = [];

  const written = await mutateLibrary((library) => {
  const solos = library.solos;
  const out: Solo[] = [];

  for (const incoming of entries) {
    const index = solos.findIndex((solo) => solo.id === incoming.id);
    if (index === -1) continue;
    const current = solos[index];

    const shared: Partial<Solo> = {};
    for (const key of SHARED) {
      if (key in body) Object.assign(shared, { [key]: body[key] });
    }

    const own: Partial<Solo> = {};
    for (const key of OWN) {
      if (key in incoming) Object.assign(own, { [key]: incoming[key] });
    }

    // Moving an entry point moves the source timestamp with it: they
    // describe the same instant from two different origins.
    let soloStart = shared.soloStart ?? current.soloStart;
    if (typeof shared.leadIn === "number" && shared.leadIn !== current.leadIn) {
      const clamped = Math.max(0, Math.min(shared.leadIn, current.clipDuration));
      soloStart = Math.max(0, current.soloStart + (clamped - current.leadIn));
      shared.leadIn = Number(clamped.toFixed(3));
    }

    /*
     * The stems are never taken from the client. They are written by the
     * split and ruled on in the review block, and a form posting the copy it
     * opened with would undo an approval made while it was open — which is
     * exactly what used to happen. Neither `SHARED` nor `OWN` names them, and
     * the two places they could still ride in on are pinned here.
     */
    const merged: Solo = {
      ...current,
      ...shared,
      ...own,
      soloStart,
      stems: current.stems,
      sources: current.sources,
    };
    if (own.soloClip) {
      merged.soloClip = {
        ...own.soloClip,
        stems: current.soloClip?.stems,
        sources: current.soloClip?.sources,
      };
    }

    const updated: Solo = {
      ...merged,
      id: current.id,
      soloStart: Number(soloStart.toFixed(3)),
      /*
       * Settled against the credits so the instrument follows the name —
       * but only where there is a solo to be soloing in. Left to default it
       * is the leader's own credit, which is how a record nobody marked a
       * solo on came to offer a drum solo.
       */
      ...(merged.soloClip
        ? resolveSoloist(merged.soloist, merged.artist, merged.personnel)
        : { soloist: resolveSoloist(merged.soloist, merged.artist, merged.personnel).soloist }),
    };
    if (!updated.soloClip) delete updated.soloistRole;

    /*
     * Moving an entry point moves the window a verdict was reached over, and
     * changing the soloist or the credits moves which heads went in at all.
     * Either way the stems answer a question that has moved, so they go and
     * the screen re-splits them.
     */
    if (typeof shared.leadIn === "number" && shared.leadIn !== current.leadIn) {
      delete updated.stems;
    }
    if (
      updated.soloClip &&
      current.soloClip &&
      updated.soloClip.leadIn !== current.soloClip.leadIn
    ) {
      updated.soloClip = { ...updated.soloClip, stems: undefined };
    }

    const shapeOf = (solo: Solo, cut: "head" | "solo") =>
      splitShapeFor({
        cut,
        role: solo.soloistRole,
        personnel: solo.personnel,
        melody: solo.melody,
        artist: solo.artist,
      });
    if (shapeOf(current, "head") !== shapeOf(updated, "head")) delete updated.stems;
    if (
      updated.soloClip &&
      shapeOf(current, "solo") !== shapeOf(updated, "solo")
    ) {
      updated.soloClip = { ...updated.soloClip, stems: undefined };
    }

    for (const source of [...(updated.sources ?? []), ...(updated.soloClip?.sources ?? [])]) {
      dropped.push(source.audio);
    }
    delete updated.sources;
    if (updated.soloClip?.sources) {
      updated.soloClip = { ...updated.soloClip, sources: undefined };
    }

    solos[index] = updated;
    out.push(updated);
  }

  // Nothing matched, so nothing to write.
  return out.length === 0 ? false : out;
  });

  if (written === false) {
    return NextResponse.json({ error: "no such records" }, { status: 404 });
  }

  /*
   * The separator's own heads go here. They are a listening aid — six files
   * per cut, kept so somebody can find where a missing bass ended up — and
   * saving is the point at which that work is over. Splitting again brings
   * them back.
   */
  for (const audio of dropped) {
    await unlink(path.join(AUDIO_DIR, path.basename(audio))).catch(() => {});
  }

  return NextResponse.json({ written });
}
