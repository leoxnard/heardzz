import { NextResponse } from "next/server";
import path from "node:path";
import { mutateLibrary, readLibrary } from "@/scripts/extract.mjs";
import { ensureSeparator, separateClip, separatorIsReady } from "@/scripts/separate.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import type { Solo } from "@/lib/types";

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

  const body = (await request.json()) as {
    id?: string;
    force?: boolean;
    /** Which cut to do. Omitted means the first one that needs doing. */
    cut?: "head" | "solo";
  };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const library = await readLibrary();
  const solos = library.solos as Solo[];
  const solo = solos.find((entry) => entry.id === body.id);
  if (!solo) return NextResponse.json({ error: "no such record" }, { status: 404 });

  const clipId = (audio: string) => path.basename(audio).replace(/\.mp3$/, "");

  /* Both cuts, in the order a listener meets them. */
  const cuts = [
    {
      cut: "head" as const,
      label: `${solo.artist} — ${solo.song}`,
      clipId: clipId(solo.audio),
      leadIn: solo.leadIn,
      stems: solo.stems,
    },
    ...(solo.soloClip
      ? [{
          cut: "solo" as const,
          label: `${solo.artist} — ${solo.song} (solo)`,
          clipId: clipId(solo.soloClip.audio),
          leadIn: solo.soloClip.leadIn,
          stems: solo.soloClip.stems,
        }]
      : []),
  ];

  /*
   * One named cut per request when the caller names one, which is how a
   * forced re-split reaches both of them. Asked for the whole record, a
   * force would otherwise redo the head, and the next request — no longer
   * forced, because forcing twice would loop — would find the solo cut still
   * holding stems and call the job done. So the caller walks the cuts and
   * this does exactly the one it is handed.
   */
  const asked = body.cut ? cuts.filter((cut) => cut.cut === body.cut) : cuts;
  const pending = body.force ? asked : asked.filter((cut) => !cut.stems);
  if (pending.length === 0) {
    return NextResponse.json({ done: true, remaining: 0, written: [] });
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
    const { stems, sources } = await separateClip({
      clipId: target.clipId,
      leadIn: target.leadIn,
      cut: target.cut,
      role: solo.soloistRole,
      personnel: solo.personnel,
      melody: solo.melody,
      artist: solo.artist,
      previous: target.stems,
    });

    /*
     * Read again inside the write rather than reusing the copy the
     * separation started from. A minute has passed and somebody may have
     * approved a stem or fixed a title in it; only this cut's result is
     * ours to put back.
     */
    const written = await mutateLibrary((current) => {
      const fresh = current.solos.find((entry) => entry.id === solo.id);
      if (!fresh) return false;

      const touched = [fresh];
      if (target.cut === "head") {
        fresh.stems = stems;
        fresh.sources = sources;
        /*
         * One head clip, one separation. The siblings name the same file and
         * would otherwise sit unsplit beside a record that has just been
         * split — and separating it again for each of them is an hour of a
         * 2013 CPU spent reproducing the files it already made.
         */
        for (const sibling of current.solos) {
          if (sibling === fresh || sibling.audio !== fresh.audio) continue;
          sibling.stems = structuredClone(stems);
          sibling.sources = structuredClone(sources);
          touched.push(sibling);
        }
      } else if (fresh.soloClip) {
        fresh.soloClip = { ...fresh.soloClip, stems, sources };
      }
      return touched;
    });

    return NextResponse.json({
      done: pending.length === 1,
      remaining: pending.length - 1,
      split: target.label,
      written: written === false ? [] : written,
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
