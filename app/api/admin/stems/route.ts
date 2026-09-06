import { NextResponse } from "next/server";
import { readLibrary, writeLibrary } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
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

  if (body.approved === null || body.approved === undefined) delete variant.approved;
  else variant.approved = Boolean(body.approved);

  await writeLibrary({ ...library, solos });
  return NextResponse.json(solo);
}
