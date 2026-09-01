import { NextResponse } from "next/server";
import { loadSolos } from "@/lib/library";
import { callerKey, take } from "@/lib/rate-limit";
import { addReport } from "@/lib/reports";
import type { ReportKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: ReportKind[] = ["audio", "info", "other"];
const NOTE_MAX = 500;

/**
 * A player flags a problem with the record on screen. No login, no email —
 * just what solo, what kind of thing is wrong, and optionally a line about
 * it. Looking the solo up server-side rather than trusting the body is what
 * keeps a report about a record that does not exist from ever reaching the
 * admin screen.
 */
export async function POST(request: Request) {
  const limit = take(`report:${callerKey(request)}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many reports for now. Try again in ${limit.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { soloId?: string; kind?: string; note?: string }
    | null;

  const soloId = String(body?.soloId ?? "").trim();
  const kind = KINDS.includes(body?.kind as ReportKind) ? (body!.kind as ReportKind) : null;
  if (!soloId || !kind) {
    return NextResponse.json({ error: "badReport" }, { status: 400 });
  }

  const solo = (await loadSolos()).find((entry) => entry.id === soloId);
  if (!solo) {
    return NextResponse.json({ error: "badReport" }, { status: 400 });
  }

  const note = String(body?.note ?? "").trim().slice(0, NOTE_MAX) || undefined;

  await addReport({
    soloId: solo.id,
    artist: solo.artist,
    song: solo.song,
    catalog: solo.catalog,
    kind,
    note,
  });

  return NextResponse.json({ ok: true });
}
