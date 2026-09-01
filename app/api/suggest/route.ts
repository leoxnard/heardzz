import { NextResponse } from "next/server";
import { addSuggestion, readSuggestions } from "@/lib/suggestions";
import { loadSolos } from "@/lib/library";
import { callerKey, take } from "@/lib/rate-limit";
import { parseYouTubeId } from "@/lib/youtube";
import type { Credit, Suggestion } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX = 200;
/** As many records as one send may carry. Matches the playlist lookup cap. */
const MAX_ITEMS = 25;

function trim(value: unknown, max = MAX): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Build the shape the reviewer will see, and nothing else from the body. */
function shape(body: Record<string, unknown>, youtubeId: string, note: string): Suggestion {
  const personnel: Credit[] = Array.isArray(body.personnel)
    ? (body.personnel as Credit[])
        .slice(0, 40)
        .map((c) => ({ name: trim(c?.name, 120), role: trim(c?.role, 120) }))
        .filter((c) => c.name)
    : [];

  return {
    id: `${youtubeId}-${Date.now().toString(36)}`,
    youtubeId,
    sourceTitle: trim(body.sourceTitle, 300),
    sourceDuration: Math.max(0, Math.min(36000, Number(body.sourceDuration) || 0)),
    artist: trim(body.artist),
    song: trim(body.song),
    album: trim(body.album),
    year: Math.max(0, Math.min(2100, Number(body.year) || 0)),
    personnel,
    discogsReleaseId: Number(body.discogsReleaseId) || undefined,
    note: note || undefined,
    submittedAt: new Date().toISOString(),
    status: "pending",
  };
}

/**
 * Store a suggestion, or a handful of them at once when they came off a
 * playlist. Nothing is downloaded until they are confirmed.
 *
 * A batch costs one rate-limit token rather than one per record: the work it
 * makes for the server is a few writes, and the size of it is capped anyway.
 */
export async function POST(request: Request) {
  const limit = take(`suggest:${callerKey(request)}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many suggestions for now. Try again in ${limit.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const body = (await request.json()) as Record<string, unknown>;
  const note = trim(body.note, 400);
  const batch = Array.isArray(body.items);
  const items = (batch ? (body.items as Record<string, unknown>[]) : [body]).slice(0, MAX_ITEMS);

  if (!items.length) {
    return NextResponse.json({ error: "Nothing to send." }, { status: 400 });
  }

  const [solos, { suggestions }] = await Promise.all([loadSolos(), readSuggestions()]);
  const known = new Set<string>([
    ...solos.map((solo) => solo.youtubeId),
    ...suggestions.filter((s) => s.status === "pending").map((s) => s.youtubeId),
  ]);

  const accepted: string[] = [];
  const rejected: { youtubeId: string; error: string }[] = [];

  for (const item of items) {
    const youtubeId = parseYouTubeId(String(item.youtubeId ?? ""));
    if (!youtubeId) {
      rejected.push({ youtubeId: trim(item.youtubeId, 40), error: "badLink" });
      continue;
    }
    if (known.has(youtubeId)) {
      const inLibrary = solos.some((solo) => solo.youtubeId === youtubeId);
      rejected.push({ youtubeId, error: inLibrary ? "alreadyHere" : "alreadyPending" });
      continue;
    }
    if (!trim(item.artist) || !trim(item.song)) {
      rejected.push({ youtubeId, error: "An artist and a tune are needed." });
      continue;
    }

    await addSuggestion(shape(item, youtubeId, trim(item.note, 400) || note));
    known.add(youtubeId);
    accepted.push(youtubeId);
  }

  // A single suggestion keeps its old, blunter answer: the one thing asked
  // for either went through or it did not.
  if (!batch) {
    const failure = rejected[0];
    if (failure) {
      const clash = failure.error === "alreadyHere" || failure.error === "alreadyPending";
      return NextResponse.json({ error: failure.error }, { status: clash ? 409 : 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!accepted.length) {
    return NextResponse.json({ error: "Nothing could be sent.", rejected }, { status: 409 });
  }
  return NextResponse.json({ ok: true, accepted: accepted.length, rejected });
}
