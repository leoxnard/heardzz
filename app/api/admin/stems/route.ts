import { NextResponse } from "next/server";
import path from "node:path";
import { mutateLibrary } from "@/scripts/extract.mjs";
import { judgeOnset, stemIsUsable } from "@/scripts/separate.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { AUDIO_DIR } from "@/lib/paths";
import type { Solo, StemId } from "@/lib/types";

export const dynamic = "force-dynamic";

const STEM_IDS: StemId[] = ["lead", "rhythm", "bass"];

/**
 * Rule on one pulled-apart layer of one cut, or move where it starts.
 *
 * Its own route rather than a field on the editor's save, because the two
 * are different acts on different timescales. Editing a record rewrites
 * whatever the form is holding; this touches one stem, and a session of
 * listening through a record's layers must not be able to roll back a title
 * somebody fixed in the meantime.
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

  const { id, stem } = body;
  if (!id || !stem || !STEM_IDS.includes(stem)) {
    return NextResponse.json({ error: "id and a known stem are required" }, { status: 400 });
  }

  const outcome = await mutateLibrary(async (library) => {
    const solo = library.solos.find((entry) => entry.id === id);
    if (!solo) return { error: "no such record", status: 404 } as const;

    const stems = body.cut === "solo" ? solo.soloClip?.stems : solo.stems;
    const variant = stems?.[stem];
    if (!variant) return { error: "that cut has not been split", status: 404 } as const;

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
      /*
       * Never before the cut's own marker. That marker is where somebody
       * decided the round begins, and a stem starting earlier would deal
       * audio the full mix never plays — one tune answered from two places
       * depending on which layer was picked. Later is the whole point.
       */
      const floor = body.cut === "solo" ? (solo.soloClip?.leadIn ?? 0) : solo.leadIn;
      const start = Math.max(floor, Number(body.leadIn.toFixed(3)));
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

    /*
     * A ruling on the head clip is a ruling on the recording. Three soloists
     * are three entries naming one file, pulled apart one way, and a yes
     * given on whichever entry happened to be open is a yes about that
     * audio — so the others take it rather than sitting at "not ruled on"
     * over the same sound. The solo cut is the entry's own and stays put.
     */
    const written = [solo];
    if (body.cut !== "solo") {
      for (const sibling of library.solos) {
        if (sibling === solo || sibling.audio !== solo.audio) continue;
        const twin = sibling.stems?.[stem];
        if (!twin) continue;
        Object.assign(twin, variant);
        written.push(sibling);
      }
    }

    // Every record this touched, so the screen holding them does not have to
    // guess which of its siblings moved.
    return { written } as const;
  });

  if ("error" in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({ written: outcome.written satisfies Solo[] });
}
