import { NextResponse } from "next/server";
import { addSuggestion, readSuggestions } from "@/lib/suggestions";
import { loadSolos } from "@/lib/library";
import { callerKey, take } from "@/lib/rate-limit";
import { parseYouTubeId } from "@/lib/youtube";
import type { Credit, Suggestion } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX = 200;

function trim(value: unknown, max = MAX): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Store a suggestion. Nothing is downloaded until it is confirmed. */
export async function POST(request: Request) {
  const limit = take(`suggest:${callerKey(request)}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many suggestions for now. Try again in ${limit.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const body = (await request.json()) as Record<string, unknown>;
  const youtubeId = parseYouTubeId(String(body.youtubeId ?? ""));
  if (!youtubeId) return NextResponse.json({ error: "badLink" }, { status: 400 });

  const artist = trim(body.artist);
  const song = trim(body.song);
  if (!artist || !song) {
    return NextResponse.json({ error: "An artist and a tune are needed." }, { status: 400 });
  }

  const [solos, { suggestions }] = await Promise.all([loadSolos(), readSuggestions()]);
  if (solos.some((solo) => solo.youtubeId === youtubeId)) {
    return NextResponse.json({ error: "alreadyHere" }, { status: 409 });
  }
  if (suggestions.some((s) => s.youtubeId === youtubeId && s.status === "pending")) {
    return NextResponse.json({ error: "alreadyPending" }, { status: 409 });
  }

  // Only the shape the reviewer will see; nothing else from the request body.
  const personnel: Credit[] = Array.isArray(body.personnel)
    ? (body.personnel as Credit[])
        .slice(0, 40)
        .map((c) => ({ name: trim(c?.name, 120), role: trim(c?.role, 120) }))
        .filter((c) => c.name)
    : [];

  const suggestion: Suggestion = {
    id: `${youtubeId}-${Date.now().toString(36)}`,
    youtubeId,
    sourceTitle: trim(body.sourceTitle, 300),
    sourceDuration: Math.max(0, Math.min(36000, Number(body.sourceDuration) || 0)),
    artist,
    song,
    album: trim(body.album),
    year: Math.max(0, Math.min(2100, Number(body.year) || 0)),
    personnel,
    discogsReleaseId: Number(body.discogsReleaseId) || undefined,
    note: trim(body.note, 400) || undefined,
    submittedAt: new Date().toISOString(),
    status: "pending",
  };

  await addSuggestion(suggestion);
  return NextResponse.json({ ok: true });
}
