import { NextResponse } from "next/server";
import path from "node:path";
import { readLibrary, writeLibrary } from "@/scripts/extract.mjs";
import { judgeOnset, stemIsUsable } from "@/scripts/separate.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { AUDIO_DIR } from "@/lib/paths";
import type { Solo, StemId } from "@/lib/types";

export const dynamic = "force-dynamic";

const STEM_IDS: StemId[] = ["lead", "rhythm", "bass"];

/**
 * Rule on one pulled-apart layer of one cut.
 *
 * Its own route rather than a field on the solo editor's save, because the
 * two are different acts on different timescales. Editing a record rewrites
 * whatever the form is holding; this touches one boolean on one variant, and
 * a session of listening through a record's six stems must not be able to
 * roll back a title somebody fixed in the meantime.
 *
 * `approved: null` puts a stem back to unruled, which is how a mistake is
 * undone — there is no third state to store, only the absence of an answer.
 */
export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as {
    id?: string;
    cut?: "head" | "solo";
    stem?: StemId;
    approved?: boolean | null;
    /** Where this stem's round opens, set by hand on the waveform. */
    leadIn?: number;
  };

  if (!body.id || !body.stem || !STEM_IDS.includes(body.stem)) {
    return NextResponse.json({ error: "id and a known stem are required" }, { status: 400 });
  }

  const library = await readLibrary();
  const solos = library.solos as Solo[];
  const solo = solos.find((entry) => entry.id === body.id);
  if (!solo) return NextResponse.json({ error: "no such record" }, { status: 404 });

  const stems = body.cut === "solo" ? solo.soloClip?.stems : solo.stems;
  const variant = stems?.[body.stem];
  if (!variant) {
    return NextResponse.json({ error: "that cut has not been split" }, { status: 404 });
  }

  if ("approved" in body) {
    if (body.approved === null || body.approved === undefined) delete variant.approved;
    else variant.approved = Boolean(body.approved);
  }

  /*
   * Moving the start moves the window the verdict was reached over, so the
   * verdict is reached again — the same argument the entry point in the
   * editor makes about the stems as a whole. Only the opening is measured:
   * the level belongs to the raw separator head, which is long gone, and
   * re-reading it off the encode reads twelve decibels loud.
   */
  if (typeof body.leadIn === "number" && Number.isFinite(body.leadIn)) {
    const clip = body.cut === "solo" ? solo.soloClip?.audio : solo.audio;
    const start = Math.max(0, Number(body.leadIn.toFixed(3)));
    variant.leadIn = start;

    if (clip) {
      const onset = await judgeOnset({
        playedFile: path.join(AUDIO_DIR, path.basename(variant.audio)),
        mixFile: path.join(AUDIO_DIR, path.basename(clip)),
        leadIn: start,
      });
      Object.assign(variant, onset);
      variant.usable = stemIsUsable({
        openLevel: variant.openLevel,
        relativeLevel: variant.relativeLevel,
        ...onset,
      });
    }
  }

  await writeLibrary({ ...library, solos });
  return NextResponse.json(solo);
}
