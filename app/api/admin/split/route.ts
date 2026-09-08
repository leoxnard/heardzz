import { NextResponse } from "next/server";
import path from "node:path";
import { readLibrary, writeLibrary } from "@/scripts/extract.mjs";
import { ensureSeparator, separateClip, separatorIsReady } from "@/scripts/separate.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import type { Solo, StemSet } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Pull one cut of one record apart.
 *
 * One cut per request, the same shape `fetch-missing` uses and for the same
 * reason: separating is around a minute of CPU on the machine this runs on,
 * a record can be two cuts, and doing them all in one request is a timeout
 * with no way to say how far it got. The screen calls this until `done`.
 *
 * The first call on a fresh volume builds the separator, which downloads
 * about a gigabyte and takes far longer than any of the work after it. That
 * is reported rather than attempted here — a request that quietly spends ten
 * minutes on setup looks exactly like one that has hung.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as { id?: string; force?: boolean };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const library = await readLibrary();
  const solos = library.solos as Solo[];
  const solo = solos.find((entry) => entry.id === body.id);
  if (!solo) return NextResponse.json({ error: "no such record" }, { status: 404 });

  const clipId = (audio: string) => path.basename(audio).replace(/\.mp3$/, "");

  /*
   * Both cuts, in the order a listener meets them. `apply` is how a result
   * gets back onto the right half of the record, which differs between the
   * two: the head clip's stems live on the record and the solo cut's on a
   * nested object.
   */
  const cuts = [
    {
      cut: "head" as const,
      label: `${solo.artist} — ${solo.song}`,
      clipId: clipId(solo.audio),
      leadIn: solo.leadIn,
      stems: solo.stems,
      apply: (stems: StemSet) => { solo.stems = stems; },
    },
    ...(solo.soloClip
      ? [{
          cut: "solo" as const,
          label: `${solo.artist} — ${solo.song} (solo)`,
          clipId: clipId(solo.soloClip.audio),
          leadIn: solo.soloClip.leadIn,
          stems: solo.soloClip.stems,
          apply: (stems: StemSet) => {
            if (solo.soloClip) solo.soloClip = { ...solo.soloClip, stems };
          },
        }]
      : []),
  ];

  const pending = body.force ? cuts : cuts.filter((cut) => !cut.stems);
  if (pending.length === 0) {
    return NextResponse.json({ done: true, remaining: 0 });
  }

  if (!separatorIsReady()) {
    return NextResponse.json(
      {
        error:
          "The separator is not built yet. It is about a gigabyte and takes " +
          "far longer than a request may — run `npm run split-stems` once " +
          "from a shell to build it, then this screen can do the rest.",
        remaining: pending.length,
      },
      { status: 503 },
    );
  }

  const target = pending[0];

  try {
    await ensureSeparator();
    const stems = await separateClip({
      clipId: target.clipId,
      leadIn: target.leadIn,
      cut: target.cut,
      role: solo.soloistRole,
      personnel: solo.personnel,
      previous: target.stems,
    });

    target.apply(stems);
    await writeLibrary({ ...library, solos });

    return NextResponse.json({
      done: pending.length === 1,
      remaining: pending.length - 1,
      split: target.label,
      solo,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message.split("\n")[0] : "Could not split it",
        remaining: pending.length,
      },
      { status: 500 },
    );
  }
}
